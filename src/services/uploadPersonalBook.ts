/**
 * The one implementation of "put this ebook in this user's library". Both
 * `POST /library/upload` and the XRPC procedure are thin adapters over it.
 *
 * The ordering of the pipeline below is the design, not an accident:
 * - Nothing large is resident unless we are actually going to keep it —
 *   streaming, head-only format detection, and the duplicate check all happen
 *   before the whole-file parse, which is the only step needing it.
 * - The row commits before the bytes move into place: quota is evaluated
 *   inside the INSERT, so a rejected upload just unlinks a temp file.
 *
 * Errors are a discriminated result, never a throw — each adapter owns its own status codes.
 */

import path from "node:path";
import { rename, rm, readdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import type { HiveId } from "../types";
import { env } from "../env";
import { Semaphore, SemaphoreFullError, SemaphoreTimeoutError } from "../lib/semaphore";
import {
  detectFormat,
  koreaderPartialMD5File,
  type BookCover,
  type BookMetadata,
  type FormatInfo,
} from "../core/bookMetadata/index";
import { parseBookInWorker } from "../workers/parse-client";
import {
  bookFilePath,
  coverFilePath,
  epubFilePath,
  ensureDir,
  getLibraryTmpDir,
  getStorageQuota,
  getStorageUsage,
  personalBookDir,
  MAX_PERSONAL_BOOK_BYTES,
} from "../data/personalLibrary";
import { convertToEpub, isConvertibleToEpub } from "./convertToEpub";
import { matchSyncDocument, NO_HIVE_MATCH } from "../data/syncMatching";
import { bridgeProgressToUserBook } from "../data/syncBridge";
import { filenameKey, koreaderFilenameHash } from "../core/filenameMatching";
import type { SyncProgressData } from "../types";

// Bytes needed for format detection — generous enough to cover the FictionBook,
// ZIP and MOBI magic-byte checks in one read.
const FORMAT_HEAD_BYTES = 4096;

/**
 * The parse is the only step holding a whole file in native memory, so this
 * is the per-process memory bound on uploads — multiplied by `WEB_CONCURRENCY`
 * across the cluster.
 * `maxPending` sheds load instead of queueing waiters: each queued caller
 * holds its temp file handle alive, and a fast 503 retries better than a hang.
 */
const parseSemaphore = new Semaphore(env.UPLOAD_PARSE_CONCURRENCY, {
  label: "ebook-parse",
  maxPending: 16,
  acquireTimeoutMs: 30_000,
});

export type UploadSource =
  | { kind: "stream"; body: ReadableStream<Uint8Array>; declaredLength?: number | undefined }
  | { kind: "bytes"; bytes: Uint8Array };

/** Exactly `buzz.bookhive.getPersonalLibrary#personalBookView`. */
export type PersonalBookView = {
  contentHash: string;
  title: string;
  authors?: string | undefined;
  language?: string | undefined;
  format: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  hiveId?: string | undefined;
  coverUrl?: string | undefined;
};

/** What happened to the EPUB derivation, for the caller's wide event — this module deliberately has no logger of its own. */
export type UploadConvertOutcome =
  | "not-applicable"
  | "ok"
  | "unsupported"
  | "unavailable"
  | "timeout"
  | "failed";

export type UploadPersonalBookResult =
  | {
      ok: true;
      book: PersonalBookView;
      storageUsedBytes: number;
      storageQuotaBytes: number;
      convert: UploadConvertOutcome;
    }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "too-large"; limitBytes: number }
  | { ok: false; reason: "unsupported-format"; filename: string }
  | { ok: false; reason: "duplicate"; contentHash: string }
  | {
      ok: false;
      reason: "quota-exceeded";
      usedBytes: number;
      quotaBytes: number;
      fileBytes: number;
    }
  | { ok: false; reason: "busy" };

/** Reasons in the order a caller is likely to want them, for exhaustive maps. */
export type UploadFailureReason = Extract<UploadPersonalBookResult, { ok: false }>["reason"];

class TooLargeError extends Error {}

/**
 * Stream a body to disk with a hard byte ceiling, holding at most one buffer's
 * worth of it at a time. Replaces hono's `bodyLimit()`, which only
 * short-circuits on `Content-Length` and otherwise buffers a chunked body
 * twice (once draining the stream, again in `formData()`); capping while
 * writing bounds every path identically.
 */
async function writeCapped(dest: string, source: UploadSource, cap: number): Promise<number> {
  // `highWaterMark` is the real memory bound: the sink buffers up to this much
  // before flushing to disk, and awaiting each write is the backpressure signal.
  const sink = Bun.file(dest).writer({ highWaterMark: 1024 * 1024 });
  let written = 0;
  try {
    if (source.kind === "bytes") {
      if (source.bytes.length > cap) throw new TooLargeError();
      await sink.write(source.bytes);
      written = source.bytes.length;
    } else {
      const reader = source.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          written += value.length;
          // Checked before the write, so nothing past the cap ever reaches disk.
          if (written > cap) throw new TooLargeError();
          await sink.write(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    await sink.end();
  } catch (err) {
    // Close the fd rather than leaking it; the caller unlinks the file.
    try {
      await sink.end();
    } catch {
      /* already ended */
    }
    throw err;
  }
  return written;
}

/**
 * Insert the row only if it keeps the user under quota.
 * The `SUM` is evaluated inside the statement, not read first and compared in
 * JS — SQLite serialises writers, so two concurrent uploads can't both
 * observe the pre-insert total; a per-process mutex wouldn't work anyway
 * since production runs multiple independent processes against one file.
 * `ON CONFLICT DO NOTHING` covers the other zero-row case (two uploads of the
 * same file racing past the duplicate check); re-reading the row afterwards
 * tells the two apart so "duplicate" never reports as "quota exceeded".
 */
async function insertIfUnderQuota(
  db: Database,
  row: {
    userDid: string;
    contentHash: string;
    hiveId: HiveId | null;
    filename: string;
    filenameHash: string | null;
    filenameKey: string | null;
    title: string;
    authors: string | null;
    language: string | null;
    format: string;
    mime: string;
    filePath: string;
    coverPath: string | null;
    coverMime: string | null;
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
  },
  quotaBytes: number,
): Promise<"inserted" | "duplicate" | "over-quota"> {
  const result = await sql<unknown>`
    INSERT INTO personal_book
      (userDid, contentHash, hiveId, filename, filenameHash, filenameKey, title, authors,
       language, format, mime, filePath, coverPath, coverMime, sizeBytes, createdAt, updatedAt)
    SELECT ${row.userDid}, ${row.contentHash}, ${row.hiveId}, ${row.filename},
           ${row.filenameHash}, ${row.filenameKey}, ${row.title}, ${row.authors},
           ${row.language}, ${row.format}, ${row.mime}, ${row.filePath},
           ${row.coverPath}, ${row.coverMime}, ${row.sizeBytes}, ${row.createdAt},
           ${row.updatedAt}
    WHERE (
      SELECT COALESCE(SUM(sizeBytes), 0) FROM personal_book WHERE userDid = ${row.userDid}
    ) + ${row.sizeBytes} <= ${quotaBytes}
    ON CONFLICT (userDid, contentHash) DO NOTHING
  `.execute(db);
  if ((result.numAffectedRows ?? 0n) > 0n) return "inserted";

  const existing = await db
    .selectFrom("personal_book")
    .select("id")
    .where("userDid", "=", row.userDid)
    .where("contentHash", "=", row.contentHash)
    .executeTakeFirst();
  return existing ? "duplicate" : "over-quota";
}

/**
 * Find an already-synced document that names the same book as this file, using
 * every identity a KOSync client might have sent (see `SAME_BOOK_FILE`).
 * Ordered so a byte-exact `documentHash` beats a filename-derived one, and
 * skipping the dismissal sentinel, which is the user saying "not on BookHive".
 */
async function findExactSyncLink(
  db: Database,
  userDid: string,
  contentHash: string,
  uploadFilenameHash: string | null,
  uploadFilenameKey: string | null,
): Promise<HiveId | null> {
  const doc = await db
    .selectFrom("sync_document")
    .select("hiveId")
    .where("userDid", "=", userDid)
    .where("hiveId", "is not", null)
    .where("hiveId", "!=", NO_HIVE_MATCH)
    .where((eb) =>
      eb.or([
        eb("documentHash", "=", contentHash),
        ...(uploadFilenameHash ? [eb("documentHash", "=", uploadFilenameHash)] : []),
        ...(uploadFilenameKey ? [eb("filenameKey", "=", uploadFilenameKey)] : []),
      ]),
    )
    .orderBy(sql`CASE WHEN documentHash = ${contentHash} THEN 0 ELSE 1 END`, "asc")
    .executeTakeFirst();
  return doc?.hiveId ?? null;
}

/** KOReader stores its fraction as 0..1; anything else we treat as absent. */
function progressPercentage(progressData: string | null | undefined): number | null {
  if (!progressData) return null;
  try {
    const parsed = JSON.parse(progressData) as SyncProgressData;
    const pct = Number(parsed.percentage);
    return Number.isFinite(pct) ? pct : null;
  } catch {
    return null;
  }
}

export type UploadPersonalBookInput = {
  db: Database;
  kv: Storage;
  userDid: string;
  filename: string;
  source: UploadSource;
  /**
   * Overrides `MAX_PERSONAL_BOOK_BYTES`. Only tests pass it — the cap is a
   * property of the deployment, not of a request, so no transport should.
   * It exists because asserting the streaming cap otherwise means actually
   * pushing 100 MB through the writer, which is the single slowest thing in
   * the test suite and proves nothing the same test at 1 MB does not.
   */
  maxBytes?: number;
};

export async function uploadPersonalBook(
  input: UploadPersonalBookInput,
): Promise<UploadPersonalBookResult> {
  const { db, kv, userDid, filename, source } = input;
  const maxBytes = input.maxBytes ?? MAX_PERSONAL_BOOK_BYTES;
  const quotaBytes = getStorageQuota();
  const declared =
    source.kind === "stream" ? source.declaredLength : (source.bytes.length as number | undefined);

  // ── 1. Reject on the declared size before reading a byte ──
  // Advisory only (client-asserted, and chunked bodies have no Content-Length) — steps 2 and 8 actually enforce these limits.
  if (declared !== undefined && declared > maxBytes) {
    return { ok: false, reason: "too-large", limitBytes: maxBytes };
  }
  if (declared !== undefined && declared > 0) {
    const used = await getStorageUsage(db, userDid);
    if (used + declared > quotaBytes) {
      return {
        ok: false,
        reason: "quota-exceeded",
        usedBytes: used,
        quotaBytes,
        fileBytes: declared,
      };
    }
  }

  // ── 2. Stream to a temp file on the same filesystem as the library ──
  const tmpDir = getLibraryTmpDir();
  await ensureDir(tmpDir);
  const tmp = path.join(tmpDir, `${randomUUID()}.part`);

  let size: number;
  try {
    size = await writeCapped(tmp, source, maxBytes);
  } catch (err) {
    await rm(tmp, { force: true });
    if (err instanceof TooLargeError) {
      return { ok: false, reason: "too-large", limitBytes: maxBytes };
    }
    throw err;
  }

  try {
    if (size === 0) return { ok: false, reason: "empty" };

    const file = Bun.file(tmp);

    // ── 3. Format, from a 4 KB head ──
    // The magic-byte check against the filename's extension is the real gate on
    // what we accept; a declared Content-Type is client-asserted and worthless.
    const head = new Uint8Array(await file.slice(0, FORMAT_HEAD_BYTES).arrayBuffer());
    const formatInfo: FormatInfo = detectFormat(head, filename);
    if (formatInfo.format === "unknown") {
      return { ok: false, reason: "unsupported-format", filename };
    }

    // ── 4. Content hash, from twelve 1 KB windows ──
    const contentHash = await koreaderPartialMD5File(file, size);

    // ── 5. Duplicate check, BEFORE the parse ──
    // Ahead of both the parse and the disk commit so a re-upload costs neither.
    const duplicate = await db
      .selectFrom("personal_book")
      .select("id")
      .where("userDid", "=", userDid)
      .where("contentHash", "=", contentHash)
      .executeTakeFirst();
    if (duplicate) return { ok: false, reason: "duplicate", contentHash };

    // ── 6+7. Parse and cover — the native-memory, CPU-bound steps ──
    // Offloaded to a single-shot Worker so the whole-file, CPU-bound parse and
    // cover raster don't stall this process's event loop; the semaphore still
    // bounds concurrency, now over live Workers.
    // The cover gate is not optional: `coverPath IS NOT NULL` is the only
    // signal driving `coverUrl` on the web library, OPDS and the XRPC book
    // view, so an unvalidated cover would be a dead URL in all three.
    let metadata: BookMetadata;
    let cover: BookCover | undefined;
    try {
      ({ metadata, cover } = await parseSemaphore.run(() =>
        parseBookInWorker(tmp, filename, formatInfo),
      ));
    } catch (err) {
      if (err instanceof SemaphoreFullError || err instanceof SemaphoreTimeoutError) {
        return { ok: false, reason: "busy" };
      }
      throw err;
    }

    // ── 8. Link, then insert under quota ──
    const uploadFilenameHash = koreaderFilenameHash(filename);
    const uploadFilenameKey = filenameKey(filename);

    // Exact first, fuzzy only on a miss — a title/author guess must never beat a byte-exact documentHash match.
    let hiveId = await findExactSyncLink(
      db,
      userDid,
      contentHash,
      uploadFilenameHash,
      uploadFilenameKey,
    );
    if (!hiveId) {
      hiveId = await matchSyncDocument(db, {
        title: metadata.title,
        authors: metadata.authors,
        filename,
      });
    }

    const now = new Date().toISOString();
    const filePath = bookFilePath(userDid, contentHash, formatInfo.ext);
    const coverPath = cover ? coverFilePath(userDid, contentHash, cover.ext) : null;

    const inserted = await insertIfUnderQuota(
      db,
      {
        userDid,
        contentHash,
        hiveId,
        filename,
        filenameHash: uploadFilenameHash,
        filenameKey: uploadFilenameKey,
        title: metadata.title,
        // `parseBook` returns "" on every fallback. Normalise to NULL so
        // `WHERE authors IS NULL` means what it looks like it means — the two
        // are identical to JS truthiness and completely different to SQL.
        authors: metadata.authors || null,
        language: metadata.language || null,
        format: formatInfo.format,
        mime: formatInfo.mime,
        filePath,
        coverPath,
        coverMime: cover?.mime ?? null,
        sizeBytes: size,
        createdAt: now,
        updatedAt: now,
      },
      quotaBytes,
    );
    if (inserted === "duplicate") return { ok: false, reason: "duplicate", contentHash };
    if (inserted === "over-quota") {
      const used = await getStorageUsage(db, userDid);
      return { ok: false, reason: "quota-exceeded", usedBytes: used, quotaBytes, fileBytes: size };
    }

    // ── 9. Commit the bytes: rename, not copy ──
    await ensureDir(personalBookDir(userDid, contentHash));
    try {
      await rename(tmp, filePath);
    } catch (err) {
      // The row committed in step 8 — roll it back so a rename failure doesn't leave a row with no file behind it.
      await db
        .deleteFrom("personal_book")
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .execute();
      throw err;
    }

    // A failed cover write must not fail the upload, but must not leave
    // `coverPath` set either — it's the only signal driving `coverUrl`.
    let coverStored = Boolean(cover && coverPath);
    if (cover && coverPath) {
      try {
        await Bun.write(coverPath, cover.bytes);
      } catch {
        coverStored = false;
        await db
          .updateTable("personal_book")
          .set({ coverPath: null, coverMime: null })
          .where("userDid", "=", userDid)
          .where("contentHash", "=", contentHash)
          .execute();
      }
    }

    // ── 9b. Derive an EPUB for formats an e-reader may refuse ──
    // After the rename, so the converter reads the committed file rather than
    // the temp path the `finally` is about to unlink. Non-fatal in every
    // branch — `epubPath` staying null just means "serve the original".
    let convertOutcome: UploadConvertOutcome = "not-applicable";
    if (isConvertibleToEpub(formatInfo.format)) {
      const epubPath = epubFilePath(userDid, contentHash);
      const converted = await convertToEpub(filePath, epubPath, formatInfo.format);
      if (converted.ok) {
        await db
          .updateTable("personal_book")
          .set({ epubPath, epubSizeBytes: converted.sizeBytes })
          .where("userDid", "=", userDid)
          .where("contentHash", "=", contentHash)
          .execute();
      } else {
        // Best-effort cleanup of any partial file the converter left behind.
        await rm(epubPath, { force: true }).catch(() => {});
      }
      convertOutcome = converted.ok ? "ok" : converted.reason;
    }

    // ── 10. Propagate the link outward ──
    if (hiveId) {
      // Any document the device has been pushing progress for that never
      // matched now points at this book — so the next push bridges instead of
      // being dropped.
      const linked = await db
        .selectFrom("sync_document")
        .select(["id", "progressData"])
        .where("userDid", "=", userDid)
        .where("hiveId", "is", null)
        .where((eb) =>
          eb.or([
            eb("documentHash", "=", contentHash),
            ...(uploadFilenameHash ? [eb("documentHash", "=", uploadFilenameHash)] : []),
            ...(uploadFilenameKey ? [eb("filenameKey", "=", uploadFilenameKey)] : []),
          ]),
        )
        .execute();

      if (linked.length > 0) {
        await db
          .updateTable("sync_document")
          .set({ hiveId })
          .where(
            "id",
            "in",
            linked.map((d) => d.id),
          )
          .execute();

        // The percentage those documents already recorded has been sitting
        // unused; without this it stays that way until the device next syncs.
        for (const doc of linked) {
          const pct = progressPercentage(doc.progressData);
          if (pct !== null) await bridgeProgressToUserBook(db, kv, userDid, hiveId, pct);
        }
      }

      await db
        .updateTable("user_book")
        .set({ owned: 1 })
        .where("userDid", "=", userDid)
        .where("hiveId", "=", hiveId)
        .where("owned", "=", 0)
        .execute();
    }

    return {
      ok: true,
      convert: convertOutcome,
      book: {
        contentHash,
        title: metadata.title,
        authors: metadata.authors || undefined,
        language: metadata.language || undefined,
        format: formatInfo.format,
        mime: formatInfo.mime,
        sizeBytes: size,
        createdAt: now,
        updatedAt: now,
        hiveId: hiveId ?? undefined,
        coverUrl: coverStored ? `/library/covers/${contentHash}` : undefined,
      },
      storageUsedBytes: await getStorageUsage(db, userDid),
      storageQuotaBytes: quotaBytes,
    };
  } finally {
    // No-op once the rename has happened; the safety net for every path that
    // returns before it.
    await rm(tmp, { force: true });
  }
}

/**
 * Delete `.part` files left behind by a process that died between the write and
 * the rename. Runs on the primary worker at startup; an hour is well past any
 * live upload (the parse semaphore times out at 30s).
 */
export async function sweepStaleUploads(maxAgeMs = 60 * 60 * 1000): Promise<number> {
  const tmpDir = getLibraryTmpDir();
  let names: string[];
  try {
    names = await readdir(tmpDir);
  } catch {
    return 0; // never uploaded anything on this host
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".part")) continue;
    const full = path.join(tmpDir, name);
    try {
      const info = await stat(full);
      if (info.mtimeMs < cutoff) {
        await rm(full, { force: true });
        removed++;
      }
    } catch {
      /* raced with another sweep or the upload itself */
    }
  }
  return removed;
}
