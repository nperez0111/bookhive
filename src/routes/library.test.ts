import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";

import type { AppEnv } from "../context";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { koreaderPartialMD5 } from "../core/bookMetadata/index";
import { NO_HIVE_MATCH } from "../data/syncMatching";
import { filenameKey, koreaderFilenameHash } from "../core/filenameMatching";
import libraryRouter from "./library";
import { testContext } from "../test/db";
import type { SessionClient } from "../auth/client";
import type { ProfileViewDetailed } from "../types";
import { createTestDb } from "../test/db";
import { FINISHED, READING, WANTTOREAD } from "../constants";

type TestApp = Hono<AppEnv>;

const DID = "did:plc:testuser";
const OTHER_DID = "did:plc:someoneelse";

/**
 * Mount the real router with the slice of AppContext these routes touch. The
 * routes under test need db + the session helpers; /sync/link additionally
 * needs a PDS session, which `fakePdsAgent` supplies.
 */
function createApp(db: Database, did: string | null = DID, agent?: SessionClient): TestApp {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set(
      "ctx",
      testContext({
        db,
        getSessionAgent: async () => (did ? (agent ?? ({ did } as SessionClient)) : null),
        getSessionDid: async () => did,
        getProfile: async () => ({ handle: "test.bsky.social" }) as unknown as ProfileViewDetailed,
      }),
    );
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
    filename?: string;
  },
) {
  const filename = opts.filename ?? "book.epub";
  await db
    .insertInto("sync_document")
    .values({
      userDid: opts.userDid ?? DID,
      provider: "kosync",
      documentHash: opts.documentHash,
      hiveId: opts.hiveId ?? null,
      filename,
      filenameKey: filenameKey(filename),
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

async function seedPersonalBook(
  db: Database,
  contentHash: string,
  filePath: string,
  filename = "book.epub",
) {
  await db
    .insertInto("personal_book")
    .values({
      userDid: DID,
      contentHash,
      hiveId: null,
      filename,
      filenameHash: koreaderFilenameHash(filename),
      filenameKey: filenameKey(filename),
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
    ({ db } = await createTestDb());
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

  it("reports hasFile=true for a client using the FILENAME checksum method", async () => {
    // KOSync's FILENAME checksum mode sends md5(basename) as the document id,
    // which never equals our content hash.
    const filename = "The Dispossessed.epub";
    await seedSyncDocument(db, { documentHash: koreaderFilenameHash(filename)!, filename });
    await seedPersonalBook(db, "some-content-hash", "/tmp/nonexistent.epub", filename);

    const [doc] = await getDocuments(app);
    expect(doc?.hasFile).toBe(true);
  });

  it("reports hasFile=true when conversion changed the bytes and the extension", async () => {
    // Neither hash can line up: the device holds an .azw3 calibre made from the
    // .epub we hold. The readable filename is the only thing left.
    await seedSyncDocument(db, {
      documentHash: "hash-from-the-converted-copy",
      filename: "Dune - Frank Herbert.azw3",
    });
    await seedPersonalBook(db, "hash-of-original", "/tmp/x.epub", "dune_-_frank_herbert.epub");

    const [doc] = await getDocuments(app);
    expect(doc?.hasFile).toBe(true);
  });

  it("lists a document once even when several uploads match it", async () => {
    // EXISTS rather than a join: a join emits one row per match.
    const filename = "Dune.epub";
    await seedSyncDocument(db, { documentHash: koreaderFilenameHash(filename)!, filename });
    await seedPersonalBook(db, "hash-a", "/tmp/a.epub", filename);
    await seedPersonalBook(db, "hash-b", "/tmp/b.epub", "Dune.azw3");

    const docs = await getDocuments(app);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.hasFile).toBe(true);
  });

  it("does not match a file with no filename key to a document with none", async () => {
    // Both keys null; `NULL = NULL` is not true, which is what stops every
    // metadata-less document matching every metadata-less upload.
    await seedSyncDocument(db, { documentHash: "hash-orphan" });
    await db.updateTable("sync_document").set({ filenameKey: null }).execute();
    await seedPersonalBook(db, "other-hash", "/tmp/nonexistent.epub");
    await db.updateTable("personal_book").set({ filenameKey: null, filenameHash: null }).execute();

    const [doc] = await getDocuments(app);
    expect(doc?.hasFile).toBe(false);
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

async function seedHiveBook(db: Database, id: HiveId) {
  await db
    .insertInto("hive_book")
    .values({
      id,
      title: "A Synced Book",
      rawTitle: "A Synced Book",
      authors: "An Author",
      source: "goodreads",
      // No cover: the create path must not try to fetch one.
      thumbnail: "",
      createdAt: now,
      updatedAt: now,
    } as never)
    .execute();
}

type WrittenBook = {
  status?: string;
  owned?: boolean;
  bookProgress?: { percent?: number };
};

/** The one PDS call the link route makes when it creates a book: `createRecord`. */
function fakePdsAgent() {
  const recorded: WrittenBook[] = [];
  const agent = {
    did: DID,
    async post(name: string, opts: { input?: { record?: WrittenBook } } = {}) {
      if (name !== "com.atproto.repo.createRecord") throw new Error(`unexpected post ${name}`);
      recorded.push(opts.input?.record ?? {});
      return {
        ok: true as const,
        data: { uri: `at://${DID}/buzz.bookhive.book/3klink`, cid: "cidlink" },
      };
    },
    async get(name: string) {
      throw new Error(`unexpected get ${name}`);
    },
  };
  return { agent: agent as unknown as SessionClient, recorded };
}

describe("POST /library/sync/link", () => {
  const HIVE_ID = "bk_linked" as HiveId;
  let db: Database;
  let recorded: WrittenBook[];
  let app: TestApp;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    const fake = fakePdsAgent();
    recorded = fake.recorded;
    app = createApp(db, DID, fake.agent);
    await seedHiveBook(db, HIVE_ID);
  });

  const link = (document: string) =>
    app.request("/library/sync/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, hiveId: HIVE_ID }),
    });

  async function userBook() {
    return db
      .selectFrom("user_book")
      .select(["status", "bookProgress", "owned", "startedAt", "finishedAt"])
      .where("userDid", "=", DID)
      .where("hiveId", "=", HIVE_ID)
      .executeTakeFirst();
  }

  async function seedUserBook(fields: {
    status: string;
    bookProgress?: { percent: number; updatedAt: string };
  }) {
    await db
      .insertInto("user_book")
      .values({
        uri: `at://${DID}/buzz.bookhive.book/3kseed`,
        cid: "cidseed",
        userDid: DID,
        hiveId: HIVE_ID,
        title: "A Synced Book",
        authors: "An Author",
        status: fields.status,
        owned: 1,
        bookProgress: fields.bookProgress ? JSON.stringify(fields.bookProgress) : null,
        createdAt: now,
        indexedAt: now,
      })
      .execute();
  }

  it("links a finished document as finished, not reading", async () => {
    // The e-reader was at 100% before the link; that has to carry across.
    await seedSyncDocument(db, { documentHash: "hash-done", percentage: 1 });

    const res = await link("hash-done");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hiveId: HIVE_ID, bookTitle: "A Synced Book" });

    const book = await userBook();
    expect(book?.status).toBe(FINISHED);
    expect(JSON.parse(book?.bookProgress ?? "{}").percent).toBe(100);
    expect(book?.finishedAt).toBeTruthy();
    expect(book?.owned).toBe(1);
    // The PDS record carries the same status.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.status).toBe(FINISHED);
  });

  it("links a partially read document as reading", async () => {
    await seedSyncDocument(db, { documentHash: "hash-half", percentage: 0.42 });

    expect((await link("hash-half")).status).toBe(200);

    const book = await userBook();
    expect(book?.status).toBe(READING);
    expect(JSON.parse(book?.bookProgress ?? "{}").percent).toBe(42);
    expect(book?.startedAt).toBeTruthy();
    expect(book?.finishedAt).toBeNull();
  });

  it("finishes an already-tracked want-to-read book at 100%", async () => {
    await seedUserBook({ status: WANTTOREAD });
    await seedSyncDocument(db, { documentHash: "hash-done", percentage: 1 });

    expect((await link("hash-done")).status).toBe(200);

    expect((await userBook())?.status).toBe(FINISHED);
  });

  it("does not reopen a finished book from a stray e-reader page-turn", async () => {
    await seedUserBook({
      status: FINISHED,
      bookProgress: { percent: 100, updatedAt: now },
    });
    await seedSyncDocument(db, { documentHash: "hash-turn", percentage: 0.1 });

    expect((await link("hash-turn")).status).toBe(200);

    const book = await userBook();
    expect(book?.status).toBe(FINISHED);
    // The reading position still advances; only the status is protected.
    expect(JSON.parse(book?.bookProgress ?? "{}").percent).toBe(10);
  });

  it("coerces a numeric-string percentage instead of discarding it", async () => {
    await seedSyncDocument(db, { documentHash: "hash-str", percentage: 1 });
    await db
      .updateTable("sync_document")
      .set({ progressData: JSON.stringify({ progress: "/body/1", percentage: "0.42" }) })
      .where("documentHash", "=", "hash-str")
      .execute();

    expect((await link("hash-str")).status).toBe(200);

    const book = await userBook();
    expect(JSON.parse(book?.bookProgress ?? "{}").percent).toBe(42);
    expect(book?.status).toBe(READING);
  });

  it("links an unparseable percentage as 0 rather than failing the record write", async () => {
    // Unguarded this is `Math.round("nope" * 100)` → NaN, which fails record
    // validation after the document link has already committed.
    await seedSyncDocument(db, { documentHash: "hash-bad", percentage: 1 });
    await db
      .updateTable("sync_document")
      .set({ progressData: JSON.stringify({ progress: "/body/1", percentage: "nope" }) })
      .where("documentHash", "=", "hash-bad")
      .execute();

    expect((await link("hash-bad")).status).toBe(200);

    const book = await userBook();
    expect(JSON.parse(book?.bookProgress ?? "{}").percent).toBe(0);
    expect(book?.status).toBe(READING);
  });

  it("404s for an unknown document and for an unknown book", async () => {
    expect((await link("nope")).status).toBe(404);

    await seedSyncDocument(db, { documentHash: "hash-1" });
    const res = await app.request("/library/sync/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: "hash-1", hiveId: "bk_missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("cannot link another user's document", async () => {
    await seedSyncDocument(db, { documentHash: "hash-theirs", userDid: OTHER_DID });

    expect((await link("hash-theirs")).status).toBe(404);
    expect(await userBook()).toBeUndefined();
  });

  it("401s without a session", async () => {
    await seedSyncDocument(db, { documentHash: "hash-1" });
    const anon = createApp(db, null);
    const res = await anon.request("/library/sync/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: "hash-1", hiveId: HIVE_ID }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /library/sync/dismiss", () => {
  let db: Database;
  let app: TestApp;

  beforeEach(async () => {
    ({ db } = await createTestDb());
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
    ({ db } = await createTestDb());
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
    ({ db } = await createTestDb());
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
    ({ db } = await createTestDb());
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
      headers: {
        accept: init.json
          ? "application/json"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  }

  beforeEach(async () => {
    ({ db } = await createTestDb());
    app = createApp(db);
    // Keyed by the same hash the upload computes, so it collides. Relies on the
    // shared core running its duplicate check before the parse and rename.
    await seedPersonalBook(db, koreaderPartialMD5(new TextEncoder().encode(FB2)), "/tmp/dupe.fb2");
  });

  it("409s a duplicate for a client that asked for JSON", async () => {
    const res = await uploadRequest(app, { json: true });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toHaveProperty("error");
  });

  it("redirects the browser back to the library with the reason", async () => {
    // Every failure round-trips a code the library page can render as an alert.
    const res = await uploadRequest(app, { json: false });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/library?error=AlreadyExists");
  });

  it("401s without a session", async () => {
    const res = await uploadRequest(createApp(db, null), { json: true });
    expect(res.status).toBe(401);
  });
});
