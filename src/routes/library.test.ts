import { describe, it, expect, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import type { AppContext, AppEnv } from "../context";
import { migrateToLatest, type DatabaseSchema, type Database } from "../db";
import type { HiveId } from "../types";
import { koreaderPartialMD5 } from "../utils/bookMetadata/index";
import { NO_HIVE_MATCH } from "../utils/syncMatching";
import libraryRouter from "./library";

type TestApp = Hono<AppEnv>;

const DID = "did:plc:testuser";
const OTHER_DID = "did:plc:someoneelse";

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

/**
 * Mount the real router with the slice of AppContext these routes touch. The
 * routes under test need only db + the session helpers; /sync/link (which also
 * needs kv and a PDS agent) is not exercised here.
 */
function createApp(db: Database, did: string | null = DID): TestApp {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("ctx", {
      db,
      getSessionAgent: async () => (did ? { did } : null),
      getSessionDid: async () => did,
      getProfile: async () => ({ handle: "test.bsky.social" }),
    } as unknown as AppContext);
    await next();
  });
  app.route("/library", libraryRouter);
  return app;
}

const now = "2026-07-29T12:00:00.000Z";

async function seedSyncDocument(
  db: Database,
  opts: {
    documentHash: string;
    hiveId?: HiveId | null;
    title?: string | null;
    percentage?: number;
    userDid?: string;
  },
) {
  await db
    .insertInto("sync_document")
    .values({
      userDid: opts.userDid ?? DID,
      provider: "kosync",
      documentHash: opts.documentHash,
      hiveId: opts.hiveId ?? null,
      filename: "book.epub",
      title: opts.title ?? "A Synced Book",
      authors: "An Author",
      progressData: JSON.stringify({
        progress: "/body/1",
        percentage: opts.percentage ?? 0.42,
        device: "Kobo Clara",
        device_id: "abc",
        timestamp: 1785312033,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .execute();
}

async function seedPersonalBook(db: Database, contentHash: string, filePath: string) {
  await db
    .insertInto("personal_book")
    .values({
      userDid: DID,
      contentHash,
      hiveId: null,
      filename: "book.epub",
      title: "An Uploaded Book",
      authors: "An Author",
      language: "en",
      format: "epub",
      mime: "application/epub+zip",
      filePath,
      coverPath: null,
      coverMime: null,
      sizeBytes: 1234,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
}

type DocumentPayload = {
  document: string;
  title: string | null;
  hiveId: string | null;
  bookTitle: string | null;
  dismissed: boolean;
  hasFile: boolean;
  percentage: number;
  device: string | null;
};

async function getDocuments(app: TestApp): Promise<DocumentPayload[]> {
  const res = await app.request("/library/sync/documents");
  expect(res.status).toBe(200);
  return ((await res.json()) as { documents: DocumentPayload[] }).documents;
}

describe("GET /library/sync/documents", () => {
  let db: Database;
  let app: TestApp;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
  });

  it("reports hasFile=false when no upload shares the document's content hash", async () => {
    await seedSyncDocument(db, { documentHash: "hash-orphan" });

    const [doc] = await getDocuments(app);
    expect(doc?.hasFile).toBe(false);
    expect(doc?.dismissed).toBe(false);
    expect(doc?.hiveId).toBeNull();
    expect(doc?.percentage).toBe(0.42);
    expect(doc?.device).toBe("Kobo Clara");
  });

  it("reports hasFile=true when an uploaded file shares the content hash", async () => {
    await seedSyncDocument(db, { documentHash: "hash-shared" });
    await seedPersonalBook(db, "hash-shared", "/tmp/nonexistent.epub");

    const [doc] = await getDocuments(app);
    expect(doc?.hasFile).toBe(true);
  });

  it("does not match another user's uploaded file", async () => {
    await seedSyncDocument(db, { documentHash: "hash-shared" });
    await seedPersonalBook(db, "hash-shared", "/tmp/nonexistent.epub");
    await db
      .updateTable("personal_book")
      .set({ userDid: OTHER_DID })
      .where("contentHash", "=", "hash-shared")
      .execute();

    const [doc] = await getDocuments(app);
    expect(doc?.hasFile).toBe(false);
  });

  it("surfaces the sentinel as dismissed with a null hiveId", async () => {
    await seedSyncDocument(db, { documentHash: "hash-dismissed", hiveId: NO_HIVE_MATCH });

    const [doc] = await getDocuments(app);
    expect(doc?.dismissed).toBe(true);
    // Never leak the sentinel — the client would render /books/bk_none.
    expect(doc?.hiveId).toBeNull();
    expect(doc?.bookTitle).toBeNull();
  });

  it("scopes documents to the session user", async () => {
    await seedSyncDocument(db, { documentHash: "hash-mine" });
    await seedSyncDocument(db, { documentHash: "hash-theirs", userDid: OTHER_DID });

    const docs = await getDocuments(app);
    expect(docs.map((d) => d.document)).toEqual(["hash-mine"]);
  });

  it("401s without a session", async () => {
    const anon = createApp(db, null);
    const res = await anon.request("/library/sync/documents");
    expect(res.status).toBe(401);
  });
});

describe("POST /library/sync/dismiss", () => {
  let db: Database;
  let app: TestApp;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
  });

  const dismiss = (document: string, dismissed: boolean) =>
    app.request("/library/sync/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, dismissed }),
    });

  it("writes the sentinel and can undo it", async () => {
    await seedSyncDocument(db, { documentHash: "hash-1" });

    expect((await dismiss("hash-1", true)).status).toBe(200);
    let row = await db
      .selectFrom("sync_document")
      .select("hiveId")
      .where("documentHash", "=", "hash-1")
      .executeTakeFirst();
    expect(row?.hiveId).toBe(NO_HIVE_MATCH);

    expect((await dismiss("hash-1", false)).status).toBe(200);
    row = await db
      .selectFrom("sync_document")
      .select("hiveId")
      .where("documentHash", "=", "hash-1")
      .executeTakeFirst();
    expect(row?.hiveId).toBeNull();
  });

  it("refuses to clobber a real link", async () => {
    await seedSyncDocument(db, { documentHash: "hash-1", hiveId: "bk_real" as HiveId });

    const res = await dismiss("hash-1", true);
    expect(res.status).toBe(404);

    const row = await db
      .selectFrom("sync_document")
      .select("hiveId")
      .where("documentHash", "=", "hash-1")
      .executeTakeFirst();
    expect(row?.hiveId).toBe("bk_real");
  });

  it("cannot dismiss another user's document", async () => {
    await seedSyncDocument(db, { documentHash: "hash-theirs", userDid: OTHER_DID });

    expect((await dismiss("hash-theirs", true)).status).toBe(404);
    const row = await db
      .selectFrom("sync_document")
      .select("hiveId")
      .where("documentHash", "=", "hash-theirs")
      .executeTakeFirst();
    expect(row?.hiveId).toBeNull();
  });

  it("rejects a malformed body", async () => {
    const res = await app.request("/library/sync/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: "hash-1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /library/sync/rename", () => {
  let db: Database;
  let app: TestApp;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
  });

  const rename = (document: string, title: string) =>
    app.request("/library/sync/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, title }),
    });

  it("renames a document", async () => {
    await seedSyncDocument(db, { documentHash: "hash-1", title: null });

    const res = await rename("hash-1", "The Real Title");
    expect(res.status).toBe(200);

    const [doc] = await getDocuments(app);
    expect(doc?.title).toBe("The Real Title");
  });

  it("cannot rename another user's document", async () => {
    await seedSyncDocument(db, { documentHash: "hash-theirs", userDid: OTHER_DID });
    expect((await rename("hash-theirs", "Nope")).status).toBe(404);
  });

  it("rejects an empty title", async () => {
    await seedSyncDocument(db, { documentHash: "hash-1" });
    expect((await rename("hash-1", "")).status).toBe(400);
  });
});

describe("POST /library/sync/delete", () => {
  let db: Database;
  let app: TestApp;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
  });

  const remove = (document: string) =>
    app.request("/library/sync/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document }),
    });

  it("forgets the document and its progress", async () => {
    await seedSyncDocument(db, { documentHash: "hash-1" });

    expect((await remove("hash-1")).status).toBe(200);
    expect(await getDocuments(app)).toEqual([]);
  });

  it("leaves the user's own book progress alone", async () => {
    // The e-reader record is ours to discard; `user_book.bookProgress` is the
    // user's BookHive reading record and is mirrored to their PDS.
    await seedSyncDocument(db, { documentHash: "hash-1", hiveId: "bk_real" as HiveId });
    await db
      .insertInto("user_book")
      .values({
        uri: `at://${DID}/buzz.bookhive.book/1`,
        cid: "cid1",
        userDid: DID,
        hiveId: "bk_real" as HiveId,
        title: "A Book",
        authors: "An Author",
        status: "buzz.bookhive.defs#reading",
        owned: 0,
        bookProgress: JSON.stringify({ percent: 42, updatedAt: now }),
        createdAt: now,
        indexedAt: now,
      })
      .execute();

    expect((await remove("hash-1")).status).toBe(200);

    const book = await db
      .selectFrom("user_book")
      .select("bookProgress")
      .where("userDid", "=", DID)
      .executeTakeFirst();
    expect(JSON.parse(book?.bookProgress ?? "{}").percent).toBe(42);
  });

  it("cannot delete another user's document", async () => {
    await seedSyncDocument(db, { documentHash: "hash-theirs", userDid: OTHER_DID });

    expect((await remove("hash-theirs")).status).toBe(404);
    const survivor = await db
      .selectFrom("sync_document")
      .select("id")
      .where("documentHash", "=", "hash-theirs")
      .executeTakeFirst();
    expect(survivor).toBeDefined();
  });

  it("404s for an unknown document", async () => {
    expect((await remove("nope")).status).toBe(404);
  });

  it("401s without a session", async () => {
    const anon = createApp(db, null);
    const res = await anon.request("/library/sync/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: "hash-1" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /library/books/:hash/download", () => {
  let db: Database;
  let app: TestApp;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
  });

  it("streams the file with an attachment disposition", async () => {
    const filePath = `/tmp/bookhive-test-${Date.now()}.epub`;
    await Bun.write(filePath, "epub bytes");
    await seedPersonalBook(db, "hash-1", filePath);

    const res = await app.request("/library/books/hash-1/download");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/epub+zip");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("book.epub");
    expect(await res.text()).toBe("epub bytes");
  });

  it("404s when the row exists but the file is gone", async () => {
    await seedPersonalBook(db, "hash-missing", "/tmp/definitely-not-here.epub");
    const res = await app.request("/library/books/hash-missing/download");
    expect(res.status).toBe(404);
  });

  it("404s for an unknown hash", async () => {
    const res = await app.request("/library/books/nope/download");
    expect(res.status).toBe(404);
  });

  it("does not serve another user's file", async () => {
    const filePath = `/tmp/bookhive-test-other-${Date.now()}.epub`;
    await Bun.write(filePath, "secret");
    await seedPersonalBook(db, "hash-theirs", filePath);
    await db
      .updateTable("personal_book")
      .set({ userDid: OTHER_DID })
      .where("contentHash", "=", "hash-theirs")
      .execute();

    const res = await app.request("/library/books/hash-theirs/download");
    expect(res.status).toBe(404);
  });

  it("401s without a session", async () => {
    const anon = createApp(db, null);
    const res = await anon.request("/library/books/hash-1/download");
    expect(res.status).toBe(401);
  });
});

describe("POST /library/upload", () => {
  let db: Database;
  let app: TestApp;

  // Smallest thing detectFormat accepts without a zip container.
  const FB2 = '<?xml version="1.0"?><FictionBook><body/></FictionBook>';

  function uploadRequest(app: TestApp, init: { json: boolean }) {
    const form = new FormData();
    form.append("file", new File([FB2], "duplicate.fb2"));
    return app.request("/library/upload", {
      method: "POST",
      body: form,
      headers: init.json ? { accept: "application/json" } : {},
    });
  }

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
    // Seed the row the uploader will collide with, keyed by the same hash the
    // upload computes, so neither request reaches the filesystem.
    await seedPersonalBook(db, koreaderPartialMD5(new TextEncoder().encode(FB2)), "/tmp/dupe.fb2");
  });

  it("409s a duplicate for a client that asked for JSON", async () => {
    const res = await uploadRequest(app, { json: true });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toHaveProperty("error");
  });

  it("still redirects the browser back to the library", async () => {
    const res = await uploadRequest(app, { json: false });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/library");
  });

  it("401s without a session", async () => {
    const res = await uploadRequest(createApp(db, null), { json: true });
    expect(res.status).toBe(401);
  });
});
