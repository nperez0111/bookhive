/**
 * The one implementation of "put this ebook in this user's library".
 *
 * There used to be two: `POST /library/upload` (live) and `processBookUpload`
 * in the XRPC router (dead code that claimed in its own doc comment to be the
 * shared core). They drifted — different cover validation, different sync
 * matching, only one of them writing the link back onto `sync_document` — which
 * is exactly the failure mode a "shared" helper nobody shares is supposed to
 * prevent. Both routes are now thin adapters over this function.
 *
 * The ordering of the pipeline below is the design, not an accident. Two
 * properties it exists to hold:
 *
 * - **Nothing large is resident unless we are actually going to keep it.** The
 *   body streams to a temp file, bounded by the sink's 1 MB high-water mark
 *   regardless of how big the upload is; format detection reads a 4 KB
 *   head; the KOReader hash reads twelve 1 KB windows; the duplicate check
 *   happens before the parse. A rejected upload — wrong format, too big, over
 *   quota, already present — never allocates a copy of the file. Only
 *   `parseBook` needs the whole thing, and that step is behind a semaphore.
 * - **The row commits before the bytes move into place.** The quota is
 *   evaluated inside the INSERT, so a rejected upload unlinks a temp file
 *   rather than discovering the problem after writing 100 MB to its final home.
 *
 * Errors are a discriminated result, never a throw. `processBookUpload` threw
 * `XRPCError` from a util, which meant a Hono route had to catch an HTTP-shaped
 * exception and translate it back. Each adapter now owns its own status codes.
 */

import path from "node:path";
import { rename, rm, readdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import type { HiveId } from "../types";
import { env } from "../env";
import { Semaphore, SemaphoreFullError, SemaphoreTimeoutError } from "./semaphore";
import {
  detectFormat,
  koreaderPartialMD5File,
  type BookCover,
  type BookMetadata,
  type FormatInfo,
} from "./bookMetadata/index";
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
} from "./personalLibrary";
import { convertToEpub, isConvertibleToEpub } from "./convertToEpub";
import { matchSyncDocument, NO_HIVE_MATCH } from "./syncMatching";
import { bridgeProgressToUserBook } from "./syncBridge";
import { filenameKey, koreaderFilenameHash } from "./filenameMatching";
import type { SyncProgressData } from "../types";

/**
 * Bytes needed for format detection. `detectFormat` reads at most the first 512
 * bytes (the FictionBook sniff), the first 4 for the ZIP magic, and 60..68 for
 * the MOBI magic — 4 KB is generous and keeps one read.
 */
const FORMAT_HEAD_BYTES = 4096;

/**
 * The parse is the only step holding a whole file (<=100 MB) in native memory,
 * so this is the memory bound on uploads. It is **per process** — at the
 * deployed `WEB_CONCURRENCY=3` the cluster-wide ceiling is `limit x 3 x 100 MB`,
 * so 2 here means roughly 630 MB worst case rather than the previous unbounded
 * ~300 MB *per in-flight upload*.
 *
 * `maxPending` sheds load instead of queueing waiters: each queued caller holds
 * its closure — and therefore its temp file handle — alive, and a client that
 * gets a fast 503 retries better than one that hangs.
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

/**
 * What happened to the EPUB derivation, for the caller's wide event. Reported
 * rather than logged because this module deliberately has no logger — both
 * adapters already own a request-scoped one.
 */
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
 * worth of it at a time.
 *
 * This is what replaces hono's `bodyLimit()` on the multipart route. That
 * middleware only short-circuits on `Content-Length`; with a chunked body it
 * drains the entire stream into an array and rebuilds the Request, so a
 * compliant 100 MB chunked upload was buffered there *and again* by
 * `formData()`. Capping while writing bounds every path identically.
 */
async function writeCapped(dest: string, source: UploadSource, cap: number): Promise<number> {
  // `highWaterMark` is the real memory bound here: the sink buffers up to this
  // much before flushing to disk, and awaiting each write is the backpressure
  // signal. (Bun's FileSink returns a number synchronously today, but the type
  // allows a Promise — awaiting handles both and costs nothing.)
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
 *
 * The `SUM` is evaluated *inside* the statement rather than read first and
 * compared in JS. SQLite serialises writers, so this is exact: two concurrent
 * uploads cannot both observe the pre-insert total. A per-process mutex would
 * not have worked anyway — production runs three independent processes against
 * one file (`server/cluster.ts`).
 *
 * `ON CONFLICT DO NOTHING` covers the other way this statement can insert
 * nothing: two uploads of the *same* file racing past the duplicate check,
 * which would otherwise raise a UNIQUE violation on
 * `idx_personal_book_user_hash` and surface as a 500 instead of the duplicate
 * the caller asked about. The two zero-row cases are told apart by re-reading
 * the row, so "duplicate" never gets reported as "quota exceeded".
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
};

export async function uploadPersonalBook(
  input: UploadPersonalBookInput,
): Promise<UploadPersonalBookResult> {
  const { db, kv, userDid, filename, source } = input;
  const quotaBytes = getStorageQuota();
  const declared =
    source.kind === "stream" ? source.declaredLength : (source.bytes.length as number | undefined);

  // ── 1. Reject on the declared size before reading a byte ──
  // Advisory (a chunked body has no Content-Length, and the value is
  // client-asserted either way), so it is an optimisation rather than the
  // control — steps 2 and 8 are what actually enforce these two limits.
  if (declared !== undefined && declared > MAX_PERSONAL_BOOK_BYTES) {
    return { ok: false, reason: "too-large", limitBytes: MAX_PERSONAL_BOOK_BYTES };
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
    size = await writeCapped(tmp, source, MAX_PERSONAL_BOOK_BYTES);
  } catch (err) {
    await rm(tmp, { force: true });
    if (err instanceof TooLargeError) {
      return { ok: false, reason: "too-large", limitBytes: MAX_PERSONAL_BOOK_BYTES };
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
    // Deliberately ahead of both the parse and the disk commit so a re-upload
    // costs neither. `src/routes/library.test.ts` leans on this ordering to
    // exercise the duplicate path without touching the library directory.
    const duplicate = await db
      .selectFrom("personal_book")
      .select("id")
      .where("userDid", "=", userDid)
      .where("contentHash", "=", contentHash)
      .executeTakeFirst();
    if (duplicate) return { ok: false, reason: "duplicate", contentHash };

    // ── 6+7. Parse and cover — the native-memory, CPU-bound steps ──
    //
    // Offloaded to a single-shot Worker (`parseBookInWorker`): `parseBook`
    // (fflate `unzipSync`) and `prepareCover` (synchronous `resvg` raster) are
    // the only whole-file, CPU-bound work in an upload, and running them inline
    // would stall this process's event loop for the duration. The Worker reads
    // the file from the temp path we just wrote, so nothing large crosses the
    // thread boundary. The semaphore still bounds concurrency — now the number
    // of live Workers, hence the native memory across them — and sheds load as
    // `busy` rather than spawning an unbounded number of them.
    //
    // The cover gate is not optional: `coverPath IS NOT NULL` is the only signal
    // driving `coverUrl` on the web library, the OPDS feed and the XRPC book
    // view, so storing an unvalidated cover produces a dead URL and a blank box
    // in all three.
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

    // Exact first, fuzzy only on a miss. The XRPC path used to run the fuzzy
    // matcher first, which let a title/author guess beat a byte-exact
    // documentHash match — strictly wrong, and it paid for up to four FTS
    // queries on the common path where the exact lookup would have answered.
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
      // The row committed in step 8, before the bytes moved. A rename failure
      // here would otherwise leave a personal_book row with no file behind it —
      // a dead download and phantom quota usage. Roll the row back before
      // rethrowing; the `finally` still unlinks the temp file.
      await db
        .deleteFrom("personal_book")
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .execute();
      throw err;
    }

    // The row is already committed, so a failed cover write must not fail the
    // upload — the book itself is fine. But it must not leave `coverPath` set
    // either: that column is the only signal driving `coverUrl` on the web
    // library, the OPDS feed and the XRPC book view, so a path with no file
    // behind it is a dead URL and a blank box in all three.
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
    //
    // After the rename, so the converter reads the committed file rather than a
    // temp path that the `finally` is about to unlink. Non-fatal in every
    // branch: the book is already stored and downloadable in its own format,
    // and `epubPath` staying null simply means "serve the original".
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
        // Best-effort: a converter that failed halfway may still have created
        // the file, and a half-written EPUB that nothing points at is just
        // wasted disk.
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
