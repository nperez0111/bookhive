/**
 * End-to-end cover for the bug PR #204 reported: an ebook uploaded *before* the
 * first KOSync push left `sync_document.hiveId` null forever, so reading
 * progress never reached the user's public book.
 *
 * The upload's writeback couldn't help — the document didn't exist yet — and the
 * KOSync handler only auto-matched on title/author, which a default-configured
 * KOReader never sends. `matchSyncDocumentForUser` closes it from the other
 * side: the document hash *is* the uploaded file's content hash, so the file's
 * own metadata (and any book already linked to it) resolves the document.
 *
 * These tests drive the real route, so they fail if either half regresses.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "unstorage";

import { wrapBunSqliteForKysely } from "../../bun-sqlite-kysely";
import type { AppContext, AppEnv } from "../../context";
import { migrateToLatest, type DatabaseSchema, type Database } from "../../db";
import type { HiveId } from "../../types";
import { currentSyncPassword } from "../../middleware/sync-auth";
import { getHiveId } from "../../scrapers/getHiveId";
import { koreaderPartialMD5 } from "../../utils/bookMetadata/index";
import { makeEpub } from "../../utils/bookMetadata/testFixtures";
import { personalBookDir } from "../../utils/personalLibrary";
import { uploadPersonalBook } from "../../utils/uploadPersonalBook";
import { NO_HIVE_MATCH } from "../../utils/syncMatching";
import kosyncRouter from "./kosync";

const DID = "did:plc:testuser";
const HANDLE = "alice.bsky.social";

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

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("ctx", {
      db,
      kv,
      baseIdResolver: {
        handle: { resolve: async (h: string) => (h === HANDLE ? DID : null) },
      },
      addWideEventContext: () => {},
    } as unknown as AppContext);
    await next();
  });
  app.route("/kosync", kosyncRouter);
  return app;
}

/** KOSync sends md5 of the derived password, not the password itself. */
async function authHeaders(): Promise<Record<string, string>> {
  const password = await currentSyncPassword(kv, DID);
  return {
    "x-auth-user": HANDLE,
    "x-auth-key": new Bun.CryptoHasher("md5").update(password).digest("hex"),
    "content-type": "application/json",
  };
}

/** Push progress the way a default-configured KOReader does: hash and nothing else. */
async function pushProgress(
  app: Hono<AppEnv>,
  document: string,
  percentage: number,
  metadata?: { filename?: string; title?: string; authors?: string },
) {
  return app.request("/kosync/syncs/progress", {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify({
      document,
      progress: "/body/DocFragment[3]",
      percentage,
      device: "kindle",
      device_id: "dev-1",
      ...(metadata ? { metadata } : {}),
    }),
  });
}

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

async function seedUserBook(hiveId: HiveId): Promise<void> {
  await db
    .insertInto("user_book")
    .values({
      uri: `at://${DID}/buzz.bookhive.book/${hiveId}`,
      cid: "cid",
      userDid: DID,
      hiveId,
      title: "t",
      authors: "a",
      status: "buzz.bookhive.defs#reading",
      owned: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      indexedAt: "2026-08-01T00:00:00.000Z",
    })
    .execute();
}

beforeEach(async () => {
  db = await createTestDb();
  kv = createStorage({ driver: memoryDriver() });
});

afterEach(async () => {
  await rm(path.dirname(personalBookDir(DID, "x")), { recursive: true, force: true }).catch(
    () => {},
  );
});

describe("PUT /kosync/syncs/progress — upload first, then sync", () => {
  it("bridges progress to the public book for a client sending only a hash", async () => {
    // This is the reported bug, in order: the file is uploaded, the catalogue
    // book exists, and only then does the device push — with no metadata at all.
    const hiveId = await seedHiveBook("Dune", "Frank Herbert");
    await seedUserBook(hiveId);

    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"] });
    const upload = await uploadPersonalBook({
      db,
      kv,
      userDid: DID,
      filename: "Dune.epub",
      source: {
        kind: "stream",
        body: new Blob([bytes as BlobPart]).stream(),
        declaredLength: bytes.length,
      },
    });
    expect(upload.ok).toBe(true);

    const res = await pushProgress(createApp(), koreaderPartialMD5(bytes), 0.42);
    expect(res.status).toBe(200);

    const doc = await db.selectFrom("sync_document").select("hiveId").executeTakeFirstOrThrow();
    expect(doc.hiveId).toBe(hiveId);

    const userBook = await db
      .selectFrom("user_book")
      .select(["bookProgress", "owned"])
      .executeTakeFirstOrThrow();
    expect(JSON.parse(userBook.bookProgress!).percent).toBe(42);
    expect(userBook.owned).toBe(1);
  });

  it("still bridges when the upload had already resolved the book itself", async () => {
    // The file carries the link; the document inherits it rather than
    // re-deriving it from metadata the client never sent.
    const hiveId = await seedHiveBook("Neuromancer", "William Gibson");
    await seedUserBook(hiveId);

    const bytes = makeEpub({ title: "Neuromancer", authors: ["William Gibson"] });
    await uploadPersonalBook({
      db,
      kv,
      userDid: DID,
      filename: "Neuromancer.epub",
      source: {
        kind: "stream",
        body: new Blob([bytes as BlobPart]).stream(),
        declaredLength: bytes.length,
      },
    });
    const file = await db.selectFrom("personal_book").select("hiveId").executeTakeFirstOrThrow();
    expect(file.hiveId).toBe(hiveId);

    await pushProgress(createApp(), koreaderPartialMD5(bytes), 0.9);

    const userBook = await db
      .selectFrom("user_book")
      .select("bookProgress")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(userBook.bookProgress!).percent).toBe(90);
  });

  it("does not overwrite a link the user set by hand", async () => {
    const theirs = await seedHiveBook("Dune", "Frank Herbert");
    const manual = "bk_manualchoice" as HiveId;
    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"] });

    await db
      .insertInto("sync_document")
      .values({
        userDid: DID,
        provider: "kosync",
        documentHash: koreaderPartialMD5(bytes),
        hiveId: manual,
        progressData: "{}",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      })
      .execute();

    await pushProgress(createApp(), koreaderPartialMD5(bytes), 0.5);

    const doc = await db.selectFrom("sync_document").select("hiveId").executeTakeFirstOrThrow();
    expect(doc.hiveId).toBe(manual);
    expect(doc.hiveId).not.toBe(theirs);
  });

  it("respects a dismissed document and never bridges onto the sentinel", async () => {
    const hiveId = await seedHiveBook("Dune", "Frank Herbert");
    await seedUserBook(hiveId);
    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"] });

    await db
      .insertInto("sync_document")
      .values({
        userDid: DID,
        provider: "kosync",
        documentHash: koreaderPartialMD5(bytes),
        hiveId: NO_HIVE_MATCH,
        progressData: "{}",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      })
      .execute();

    const res = await pushProgress(createApp(), koreaderPartialMD5(bytes), 0.5);
    expect(res.status).toBe(200);

    const doc = await db.selectFrom("sync_document").select("hiveId").executeTakeFirstOrThrow();
    expect(doc.hiveId).toBe(NO_HIVE_MATCH);
    const userBook = await db
      .selectFrom("user_book")
      .select("bookProgress")
      .executeTakeFirstOrThrow();
    expect(userBook.bookProgress).toBeNull();
  });

  it("401s without valid sync credentials", async () => {
    const res = await createApp().request("/kosync/syncs/progress", {
      method: "PUT",
      headers: { "x-auth-user": HANDLE, "x-auth-key": "wrong", "content-type": "application/json" },
      body: JSON.stringify({
        document: "d",
        progress: "p",
        percentage: 0.1,
        device: "k",
        device_id: "1",
      }),
    });
    expect(res.status).toBe(401);
  });
});
