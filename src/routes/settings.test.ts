import { describe, it, expect, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import type { AppContext, AppEnv } from "../context";
import { migrateToLatest, type DatabaseSchema, type Database } from "../db";
import type { HiveId } from "../types";
import { NO_HIVE_MATCH } from "../utils/syncMatching";
import settingsRouter from "./settings";

type TestApp = Hono<AppEnv>;

const DID = "did:plc:testuser";

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

// Mount the real router with the slice of AppContext /sync/documents touches.
function createApp(db: Database, did: string | null = DID): TestApp {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("ctx", {
      db,
      getSessionAgent: async () => (did ? { did } : null),
    } as unknown as AppContext);
    await next();
  });
  app.route("/settings", settingsRouter);
  return app;
}

const now = "2026-07-29T12:00:00.000Z";

async function seedSyncDocument(
  db: Database,
  opts: { documentHash: string; hiveId?: HiveId | null },
) {
  await db
    .insertInto("sync_document")
    .values({
      userDid: DID,
      provider: "kosync",
      documentHash: opts.documentHash,
      hiveId: opts.hiveId ?? null,
      filename: "book.epub",
      title: "A Synced Book",
      authors: "An Author",
      progressData: JSON.stringify({
        progress: "/body/1",
        percentage: 0.42,
        device: "Kobo Clara",
        device_id: "abc",
        timestamp: 1785312033,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .execute();
}

type DocumentPayload = { hiveId: string | null; bookTitle: string | null; dismissed: boolean };

async function getDocuments(app: TestApp): Promise<DocumentPayload[]> {
  const res = await app.request("/settings/sync/documents");
  expect(res.status).toBe(200);
  return ((await res.json()) as { documents: DocumentPayload[] }).documents;
}

describe("GET /settings/sync/documents", () => {
  let db: Database;
  let app: TestApp;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
  });

  it("surfaces the sentinel as dismissed with a null hiveId", async () => {
    await seedSyncDocument(db, { documentHash: "hash-dismissed", hiveId: NO_HIVE_MATCH });

    const [doc] = await getDocuments(app);
    expect(doc?.dismissed).toBe(true);
    // Never leak the sentinel — the mobile client would render /books/bk_none.
    expect(doc?.hiveId).toBeNull();
    expect(doc?.bookTitle).toBeNull();
  });

  it("leaves an unlinked document undismissed", async () => {
    await seedSyncDocument(db, { documentHash: "hash-orphan" });

    const [doc] = await getDocuments(app);
    expect(doc?.dismissed).toBe(false);
    expect(doc?.hiveId).toBeNull();
  });

  it("excludes documents belonging to a different user", async () => {
    await seedSyncDocument(db, { documentHash: "hash-mine" });
    await db
      .insertInto("sync_document")
      .values({
        userDid: "did:plc:otheruser",
        provider: "kosync",
        documentHash: "hash-theirs",
        hiveId: null,
        filename: "other.epub",
        title: "Someone Else's Book",
        authors: "Other Author",
        progressData: JSON.stringify({
          progress: "/body/1",
          percentage: 0.1,
          device: "Kindle",
          device_id: "xyz",
          timestamp: 1785312033,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const docs = await getDocuments(app);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.hiveId).toBeNull();
    expect(docs[0]?.dismissed).toBe(false);
  });

  it("401s without a session", async () => {
    const anon = createApp(db, null);
    const res = await anon.request("/settings/sync/documents");
    expect(res.status).toBe(401);
  });
});
