import { describe, it, expect, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import { READING, WANTTOREAD } from "../constants";
import type { HiveId } from "../types";
import { bridgeProgressToUserBook, type PendingWrite } from "./syncBridge";
import { NO_HIVE_MATCH } from "./syncMatching";

const DID = "did:plc:testuser";
const HIVE_ID = "bk_realbook" as HiveId;
const URI = `at://${DID}/buzz.bookhive.book/1`;

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

describe("bridgeProgressToUserBook", () => {
  let db: Database;
  let kv: ReturnType<typeof createStorage>;

  beforeEach(async () => {
    db = await createTestDb();
    kv = createStorage({ driver: memoryDriver() });

    await db
      .insertInto("user_book")
      .values({
        uri: URI,
        cid: "cid1",
        userDid: DID,
        hiveId: HIVE_ID,
        title: "A Book",
        authors: "An Author",
        status: WANTTOREAD,
        owned: 0,
        createdAt: "2026-07-29T12:00:00.000Z",
        indexedAt: "2026-07-29T12:00:00.000Z",
      })
      .execute();
  });

  const readUserBook = () =>
    db
      .selectFrom("user_book")
      .select(["status", "bookProgress"])
      .where("uri", "=", URI)
      .executeTakeFirst();

  it("writes progress and promotes the book to reading", async () => {
    await bridgeProgressToUserBook(db, kv, DID, HIVE_ID, 0.42);

    const row = await readUserBook();
    expect(row?.status).toBe(READING);
    expect(JSON.parse(row?.bookProgress ?? "{}").percent).toBe(42);

    const pending = await kv.getItem<PendingWrite[]>(`sync_pending:${DID}`);
    expect(pending?.[0]?.hiveId).toBe(HIVE_ID);
  });

  it("ignores the dismissed sentinel even if a user_book somehow carries it", async () => {
    // The lookup would normally miss anyway, so seed the pathological row that
    // makes the guard load-bearing: without it this would write progress and
    // queue a PDS write for a hiveId that resolves to nothing.
    const sentinelUri = `at://${DID}/buzz.bookhive.book/2`;
    await db
      .insertInto("user_book")
      .values({
        uri: sentinelUri,
        cid: "cid2",
        userDid: DID,
        hiveId: NO_HIVE_MATCH,
        title: "Mystery document",
        authors: "Unknown",
        status: WANTTOREAD,
        owned: 0,
        createdAt: "2026-07-29T12:00:00.000Z",
        indexedAt: "2026-07-29T12:00:00.000Z",
      })
      .execute();

    await bridgeProgressToUserBook(db, kv, DID, NO_HIVE_MATCH, 0.9);

    const row = await db
      .selectFrom("user_book")
      .select(["status", "bookProgress"])
      .where("uri", "=", sentinelUri)
      .executeTakeFirst();
    expect(row?.status).toBe(WANTTOREAD);
    expect(row?.bookProgress).toBeNull();
    expect(await kv.getItem(`sync_pending:${DID}`)).toBeNull();
  });

  it("no-ops when the user does not track the book", async () => {
    await bridgeProgressToUserBook(db, kv, DID, "bk_untracked" as HiveId, 0.5);
    expect(await kv.getItem(`sync_pending:${DID}`)).toBeNull();
  });
});
