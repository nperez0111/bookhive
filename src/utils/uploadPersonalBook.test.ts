import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "unstorage";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type DatabaseSchema, type Database } from "../db";
import type { HiveId } from "../types";
import { imageMeta } from "image-meta";
import { koreaderPartialMD5, MIN_COVER_DIMENSION } from "./bookMetadata/index";
import { makeCbz, makeEpub, makeFb2, makeSvgCover, PNG_1 } from "./bookMetadata/testFixtures";
import { filenameKey, koreaderFilenameHash } from "./filenameMatching";
import { getHiveId } from "../scrapers/getHiveId";
import { NO_HIVE_MATCH } from "./syncMatching";
import {
  bookFilePath,
  coverFilePath,
  ensureDir,
  getLibraryTmpDir,
  getStorageQuota,
  getStorageUsage,
  personalBookDir,
  MAX_PERSONAL_BOOK_BYTES,
} from "./personalLibrary";
import { uploadPersonalBook, type UploadPersonalBookResult } from "./uploadPersonalBook";

const DID = "did:plc:testuser";
const OTHER_DID = "did:plc:someoneelse";
const HIVE_A = "bk_aaaaaaaa" as HiveId;

let db: Database;
let kv: Storage;

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const database = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(database, sqlite);
  return database;
}

/** Upload from a buffer, through the same stream path a real request uses. */
function upload(
  bytes: Uint8Array,
  filename: string,
  opts: { userDid?: string; declaredLength?: number | undefined; chunked?: boolean } = {},
): Promise<UploadPersonalBookResult> {
  const userDid = opts.userDid ?? DID;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Two chunks, so the streaming path is genuinely exercised rather than
      // degenerating into a single write.
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.subarray(0, mid));
      controller.enqueue(bytes.subarray(mid));
      controller.close();
    },
  });
  return uploadPersonalBook({
    db,
    kv,
    userDid,
    filename,
    // `chunked` models a request with no Content-Length.
    source: {
      kind: "stream",
      body,
      declaredLength: opts.chunked ? undefined : (opts.declaredLength ?? bytes.length),
    },
  });
}

async function seedSyncDocument(opts: {
  documentHash: string;
  hiveId?: HiveId | null;
  filename?: string | null;
  title?: string | null;
  authors?: string | null;
  percentage?: number;
  userDid?: string;
}): Promise<void> {
  await db
    .insertInto("sync_document")
    .values({
      userDid: opts.userDid ?? DID,
      provider: "kosync",
      documentHash: opts.documentHash,
      hiveId: opts.hiveId ?? null,
      filename: opts.filename ?? null,
      filenameKey: filenameKey(opts.filename ?? null),
      title: opts.title ?? null,
      authors: opts.authors ?? null,
      progressData: JSON.stringify({
        progress: "1",
        percentage: opts.percentage ?? 0.5,
        device: "kindle",
        device_id: "d1",
        timestamp: 1,
      }),
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    })
    .execute();
}

/**
 * Seed a catalog book. Returns its id, which is derived from title+author —
 * `matchSyncDocument`'s strongest tier recomputes exactly that hash and looks
 * it up, so a fuzzy-match test only works with the real derived id.
 */
async function seedHiveBook(title: string, authors: string): Promise<HiveId> {
  const id = getHiveId({ title, authors });
  await db
    .insertInto("hive_book")
    .values({
      id,
      title,
      rawTitle: title,
      authors,
      source: "goodreads",
      thumbnail: "",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    } as never)
    .execute();
  return id;
}

async function seedUserBook(hiveId: HiveId, owned = 0, userDid = DID): Promise<void> {
  await db
    .insertInto("user_book")
    .values({
      uri: `at://${userDid}/buzz.bookhive.book/${hiveId}`,
      cid: "cid",
      userDid,
      hiveId,
      title: "t",
      authors: "a",
      status: "buzz.bookhive.defs#reading",
      owned,
      createdAt: "2026-08-01T00:00:00.000Z",
      indexedAt: "2026-08-01T00:00:00.000Z",
    })
    .execute();
}

/** Seed a row directly, for quota arithmetic that shouldn't touch the disk. */
async function seedPersonalBook(contentHash: string, sizeBytes: number, userDid = DID) {
  await db
    .insertInto("personal_book")
    .values({
      userDid,
      contentHash,
      filename: `${contentHash}.epub`,
      title: "Seeded",
      format: "epub",
      mime: "application/epub+zip",
      filePath: `/tmp/${contentHash}.epub`,
      sizeBytes,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    })
    .execute();
}

async function tmpEntries(): Promise<string[]> {
  try {
    return (await readdir(getLibraryTmpDir())).filter((n) => n.endsWith(".part"));
  } catch {
    return [];
  }
}

beforeEach(async () => {
  db = await createTestDb();
  kv = createStorage({ driver: memoryDriver() });
  // The preload points LIBRARY_DIR at a per-pid tmp root; make sure it exists
  // and is empty so leftover files can't make an assertion pass.
  await ensureDir(getLibraryTmpDir());
  await rm(personalBookDir(DID, ""), { recursive: true, force: true }).catch(() => {});
});

afterEach(async () => {
  for (const did of [DID, OTHER_DID]) {
    await rm(path.dirname(personalBookDir(did, "x")), { recursive: true, force: true }).catch(
      () => {},
    );
  }
  for (const name of await tmpEntries()) {
    await rm(path.join(getLibraryTmpDir(), name), { force: true });
  }
});

describe("uploadPersonalBook — happy path", () => {
  it("writes the file and cover to disk and persists every column", async () => {
    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"], language: "en" });
    const result = await upload(bytes, "Dune.epub");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.book.title).toBe("Dune");
    expect(result.book.authors).toBe("Frank Herbert");
    expect(result.book.language).toBe("en");
    expect(result.book.format).toBe("epub");
    expect(result.book.mime).toBe("application/epub+zip");
    expect(result.book.sizeBytes).toBe(bytes.length);
    expect(result.book.coverUrl).toBe(`/library/covers/${result.book.contentHash}`);

    const hash = result.book.contentHash;
    const stored = Bun.file(bookFilePath(DID, hash, "epub"));
    expect(await stored.exists()).toBe(true);
    expect(stored.size).toBe(bytes.length);

    const cover = Bun.file(coverFilePath(DID, hash, "png"));
    expect(await cover.exists()).toBe(true);

    const row = await db
      .selectFrom("personal_book")
      .selectAll()
      .where("userDid", "=", DID)
      .executeTakeFirstOrThrow();
    expect(row.title).toBe("Dune");
    expect(row.authors).toBe("Frank Herbert");
    expect(row.language).toBe("en");
    expect(row.sizeBytes).toBe(bytes.length);
    expect(row.filename).toBe("Dune.epub");
    expect(row.filenameHash).toBe(koreaderFilenameHash("Dune.epub"));
    expect(row.filenameKey).toBe(filenameKey("Dune.epub"));
    expect(row.coverMime).toBe("image/png");
    expect(row.coverPath).toBe(coverFilePath(DID, hash, "png"));
  });

  it("computes the same content hash streaming as in memory", async () => {
    // The KOReader-compat invariant: this hash is what lines an uploaded file
    // up with the `document` id a device sends. If the streamed and in-memory
    // implementations ever diverge, every FILENAME/BINARY match silently stops.
    for (const [bytes, name] of [
      [makeEpub(), "a.epub"],
      [makeFb2(), "b.fb2"],
      [makeEpub({ padBytes: 70_000 }), "c.epub"],
    ] as const) {
      const result = await upload(bytes, name);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.book.contentHash).toBe(koreaderPartialMD5(bytes));
      await db.deleteFrom("personal_book").execute();
    }
  });

  it("leaves no temp file behind", async () => {
    await upload(makeEpub(), "x.epub");
    expect(await tmpEntries()).toEqual([]);
  });

  it("reports storage usage after the upload", async () => {
    const bytes = makeEpub();
    const result = await upload(bytes, "x.epub");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storageUsedBytes).toBe(bytes.length);
    expect(result.storageQuotaBytes).toBe(getStorageQuota());
  });
});

describe("uploadPersonalBook — cover handling", () => {
  it("stores no cover when the extracted image is too small to be real", async () => {
    const result = await upload(makeEpub({ cover: PNG_1 }), "tiny.epub");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.book.coverUrl).toBeUndefined();
    const row = await db
      .selectFrom("personal_book")
      .select(["coverPath", "coverMime"])
      .executeTakeFirstOrThrow();
    expect(row.coverPath).toBeNull();
    expect(row.coverMime).toBeNull();

    // And nothing was written for it.
    const dir = await readdir(personalBookDir(DID, result.book.contentHash));
    expect(dir.some((n) => n.startsWith("cover."))).toBe(false);
  });

  it("takes the first page of a CBZ as the cover", async () => {
    const result = await upload(makeCbz(), "comic.cbz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.book.format).toBe("cbz");
    expect(await Bun.file(coverFilePath(DID, result.book.contentHash, "png")).exists()).toBe(true);
  });

  it("rasterizes an SVG cover, the shape every Standard Ebooks book ships", async () => {
    // Before this, `isUsableCover` asked Bun's image pipeline to decode the SVG,
    // it answered "unrecognised format", and the entire Standard Ebooks corpus
    // uploaded with no cover at all.
    const result = await upload(
      makeEpub({
        cover: makeSvgCover(),
        coverName: "cover.svg",
        coverMediaType: "image/svg+xml",
      }),
      "standard-ebooks.epub",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Stored as a raster, never as SVG: OPDS clients and e-readers can't be
    // relied on to render vector covers, and an SVG served from our own origin
    // would be script-capable where a JPEG is inert.
    const row = await db
      .selectFrom("personal_book")
      .select(["coverPath", "coverMime"])
      .executeTakeFirstOrThrow();
    expect(row.coverMime).toBe("image/jpeg");
    expect(row.coverPath).toBe(coverFilePath(DID, result.book.contentHash, "jpg"));
    expect(result.book.coverUrl).toBe(`/library/covers/${result.book.contentHash}`);

    const onDisk = new Uint8Array(await Bun.file(row.coverPath!).arrayBuffer());
    const meta = imageMeta(onDisk);
    expect(meta.type).toBe("jpg");
    expect(meta.width).toBeGreaterThanOrEqual(MIN_COVER_DIMENSION);
    expect(meta.height).toBeGreaterThanOrEqual(MIN_COVER_DIMENSION);
  });
});

describe("uploadPersonalBook — empty metadata normalisation", () => {
  it("stores NULL rather than empty string for missing authors and language", async () => {
    // A CBZ carries no metadata at all, so parseBook returns authors: "".
    const result = await upload(makeCbz(2, 100), "Nameless.cbz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.book.authors).toBeUndefined();
    expect(result.book.language).toBeUndefined();

    const row = await db
      .selectFrom("personal_book")
      .select(["authors", "language"])
      .executeTakeFirstOrThrow();
    expect(row.authors).toBeNull();
    expect(row.language).toBeNull();

    // The point of NULL over "": this predicate has to find the row.
    const missing = await db
      .selectFrom("personal_book")
      .select("id")
      .where("authors", "is", null)
      .execute();
    expect(missing).toHaveLength(1);
  });
});

describe("uploadPersonalBook — sync document linking", () => {
  it("links via an exact content hash", async () => {
    const bytes = makeEpub();
    await seedSyncDocument({ documentHash: koreaderPartialMD5(bytes), hiveId: HIVE_A });

    const result = await upload(bytes, "x.epub");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.hiveId).toBe(HIVE_A);
  });

  it("links via the filename hash a FILENAME-mode client sends", async () => {
    await seedSyncDocument({
      documentHash: koreaderFilenameHash("Dune.epub")!,
      hiveId: HIVE_A,
    });

    const result = await upload(makeEpub(), "Dune.epub");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.hiveId).toBe(HIVE_A);
  });

  it("links via the normalised filename key across a format conversion", async () => {
    await seedSyncDocument({
      documentHash: "unrelated-hash",
      hiveId: HIVE_A,
      filename: "Dune.azw3",
    });

    const result = await upload(makeEpub(), "Dune.epub");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.hiveId).toBe(HIVE_A);
  });

  it("prefers a byte-exact document over a fuzzy title match", async () => {
    // The regression this pins: the XRPC path used to run the fuzzy matcher
    // first, so a title guess could beat an exact documentHash. Both links are
    // available here and the exact one has to win.
    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"] });
    const fuzzyId = await seedHiveBook("Dune", "Frank Herbert");
    await seedSyncDocument({ documentHash: koreaderPartialMD5(bytes), hiveId: HIVE_A });

    const result = await upload(bytes, "Dune.epub");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.book.hiveId).toBe(HIVE_A);
      expect(result.book.hiveId).not.toBe(fuzzyId);
    }
  });

  it("falls back to fuzzy matching when no document matches", async () => {
    const hiveId = await seedHiveBook("Dune", "Frank Herbert");
    const result = await upload(
      makeEpub({ title: "Dune", authors: ["Frank Herbert"] }),
      "Dune.epub",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.hiveId).toBe(hiveId);
  });

  it("never adopts the dismissal sentinel", async () => {
    const bytes = makeEpub({ title: "Untraceable Xyzzy", authors: ["Nobody At All"] });
    await seedSyncDocument({
      documentHash: koreaderPartialMD5(bytes),
      hiveId: NO_HIVE_MATCH,
    });

    const result = await upload(bytes, "x.epub");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.hiveId).toBeUndefined();
  });

  it("writes the link back onto an unmatched document and bridges its progress", async () => {
    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"] });
    const hiveId = await seedHiveBook("Dune", "Frank Herbert");
    await seedUserBook(hiveId);
    // A document the device has been pushing progress for that never matched.
    await seedSyncDocument({
      documentHash: koreaderPartialMD5(bytes),
      hiveId: null,
      percentage: 0.42,
    });

    const result = await upload(bytes, "Dune.epub");
    expect(result.ok).toBe(true);

    const doc = await db.selectFrom("sync_document").select("hiveId").executeTakeFirstOrThrow();
    expect(doc.hiveId).toBe(hiveId);

    // The percentage it had already recorded is now on the user's book, rather
    // than sitting unused until the device next syncs.
    const userBook = await db
      .selectFrom("user_book")
      .select(["bookProgress", "owned"])
      .executeTakeFirstOrThrow();
    expect(JSON.parse(userBook.bookProgress!).percent).toBe(42);
    expect(userBook.owned).toBe(1);
  });

  it("does not clobber a document the user linked by hand", async () => {
    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"] });
    await seedHiveBook("Dune", "Frank Herbert");
    await seedSyncDocument({ documentHash: koreaderPartialMD5(bytes), hiveId: HIVE_A });

    await upload(bytes, "Dune.epub");
    const doc = await db.selectFrom("sync_document").select("hiveId").executeTakeFirstOrThrow();
    expect(doc.hiveId).toBe(HIVE_A);
  });

  it("flips owned only for the uploading user", async () => {
    const bytes = makeEpub();
    await seedSyncDocument({ documentHash: koreaderPartialMD5(bytes), hiveId: HIVE_A });
    await seedUserBook(HIVE_A, 0, DID);
    await seedUserBook(HIVE_A, 0, OTHER_DID);

    await upload(bytes, "x.epub");

    const mine = await db
      .selectFrom("user_book")
      .select("owned")
      .where("userDid", "=", DID)
      .executeTakeFirstOrThrow();
    const theirs = await db
      .selectFrom("user_book")
      .select("owned")
      .where("userDid", "=", OTHER_DID)
      .executeTakeFirstOrThrow();
    expect(mine.owned).toBe(1);
    expect(theirs.owned).toBe(0);
  });
});

describe("uploadPersonalBook — rejections", () => {
  it("rejects an unsupported format and leaves nothing behind", async () => {
    const result = await upload(new TextEncoder().encode("just some text"), "notes.txt");
    expect(result).toEqual({ ok: false, reason: "unsupported-format", filename: "notes.txt" });
    expect(await db.selectFrom("personal_book").selectAll().execute()).toHaveLength(0);
    expect(await tmpEntries()).toEqual([]);
  });

  it("rejects an empty body", async () => {
    const result = await upload(new Uint8Array(0), "empty.epub");
    expect(result).toEqual({ ok: false, reason: "empty" });
    expect(await tmpEntries()).toEqual([]);
  });

  it("rejects a file merely named .epub", async () => {
    // detectFormat validates the extension's claim against the magic bytes —
    // this is the real gate, not the declared Content-Type.
    const result = await upload(new TextEncoder().encode("not a zip at all"), "fake.epub");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-format");
  });

  it("rejects a duplicate without writing anything", async () => {
    const bytes = makeEpub();
    const first = await upload(bytes, "x.epub");
    expect(first.ok).toBe(true);

    const second = await upload(bytes, "x.epub");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("duplicate");

    expect(await db.selectFrom("personal_book").selectAll().execute()).toHaveLength(1);
    expect(await tmpEntries()).toEqual([]);
  });

  it("lets two users hold the same bytes independently", async () => {
    // The duplicate check is scoped to (userDid, contentHash) — a cross-user
    // hash collision is the normal case (the same book), not an error.
    const bytes = makeEpub();
    const mine = await upload(bytes, "x.epub", { userDid: DID });
    const theirs = await upload(bytes, "x.epub", { userDid: OTHER_DID });

    expect(mine.ok).toBe(true);
    expect(theirs.ok).toBe(true);
    expect(await db.selectFrom("personal_book").selectAll().execute()).toHaveLength(2);
    if (mine.ok && theirs.ok) {
      expect(await Bun.file(bookFilePath(DID, mine.book.contentHash, "epub")).exists()).toBe(true);
      expect(
        await Bun.file(bookFilePath(OTHER_DID, theirs.book.contentHash, "epub")).exists(),
      ).toBe(true);
    }
  });

  it("caps a chunked body with no declared length", async () => {
    // The case hono's bodyLimit() buffered whole: no Content-Length, so the
    // ceiling can only be enforced while streaming.
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new Uint8Array(1024 * 1024);
        for (let sent = 0; sent <= MAX_PERSONAL_BOOK_BYTES; sent += chunk.length) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const result = await uploadPersonalBook({
      db,
      kv,
      userDid: DID,
      filename: "huge.epub",
      source: { kind: "stream", body: oversized, declaredLength: undefined },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-large");
    expect(await tmpEntries()).toEqual([]);
  }, 60_000);

  it("caps an in-memory byte source too", async () => {
    // The `bytes` branch of writeCapped is its own code path — the XRPC
    // procedure can hand the core a buffer rather than a stream, and it must
    // hit the same ceiling rather than writing the whole thing out first.
    const oversized = new Uint8Array(MAX_PERSONAL_BOOK_BYTES + 1);

    const result = await uploadPersonalBook({
      db,
      kv,
      userDid: DID,
      filename: "huge.epub",
      source: { kind: "bytes", bytes: oversized },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-large");
    expect(await db.selectFrom("personal_book").selectAll().execute()).toHaveLength(0);
    expect(await tmpEntries()).toEqual([]);
  }, 60_000);
});

describe("uploadPersonalBook — storage quota", () => {
  it("refuses an upload that would cross the quota, before reading the body", async () => {
    const bytes = makeEpub();
    // One byte of headroom short of what this upload needs.
    const used = getStorageQuota() - bytes.length + 1;
    await seedPersonalBook("seeded", used);

    const result = await upload(bytes, "x.epub");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("quota-exceeded");
      if (result.reason === "quota-exceeded") {
        expect(result.quotaBytes).toBe(getStorageQuota());
        expect(result.usedBytes).toBe(used);
      }
    }
    // Nothing stored, and the body was never drained to disk.
    expect(await db.selectFrom("personal_book").selectAll().execute()).toHaveLength(1);
    expect(await tmpEntries()).toEqual([]);
  });

  it("enforces the quota against the real size when none was declared", async () => {
    const bytes = makeEpub();
    await seedPersonalBook("seeded", getStorageQuota() - Math.floor(bytes.length / 2));

    const result = await upload(bytes, "x.epub", { chunked: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("quota-exceeded");
    expect(await db.selectFrom("personal_book").selectAll().execute()).toHaveLength(1);
    expect(await tmpEntries()).toEqual([]);
  });

  it("allows an upload that lands exactly on the quota", async () => {
    const bytes = makeEpub();
    await seedPersonalBook("seeded", getStorageQuota() - bytes.length);

    const result = await upload(bytes, "x.epub");
    expect(result.ok).toBe(true);
  });

  it("does not count another user's books toward mine", async () => {
    await seedPersonalBook("theirs", getStorageQuota(), OTHER_DID);
    const result = await upload(makeEpub(), "x.epub");
    expect(result.ok).toBe(true);
    expect(await getStorageUsage(db, OTHER_DID)).toBe(getStorageQuota());
  });

  it("frees space when a book is deleted", async () => {
    const bytes = makeEpub();
    const first = await upload(bytes, "x.epub");
    expect(first.ok).toBe(true);
    expect(await getStorageUsage(db, DID)).toBe(bytes.length);

    await db.deleteFrom("personal_book").where("userDid", "=", DID).execute();
    expect(await getStorageUsage(db, DID)).toBe(0);
  });
});
