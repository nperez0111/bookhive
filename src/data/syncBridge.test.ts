import { describe, it, expect, beforeEach } from "bun:test";

import type { Database } from "../db";
import { ABANDONED, FINISHED, READING, WANTTOREAD } from "../constants";
import type { HiveId } from "../types";
import { bridgeProgressToUserBook } from "./syncBridge";
import { NO_HIVE_MATCH } from "./syncMatching";
import { createTestDb } from "../test/db";

const DID = "did:plc:testuser";
const HIVE_ID = "bk_realbook" as HiveId;
const URI = `at://${DID}/buzz.bookhive.book/1`;

describe("bridgeProgressToUserBook", () => {
  let db: Database;

  beforeEach(async () => {
    ({ db } = await createTestDb());

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
    await bridgeProgressToUserBook(db, DID, HIVE_ID, 0.42);

    const row = await readUserBook();
    expect(row?.status).toBe(READING);
    expect(JSON.parse(row?.bookProgress ?? "{}").percent).toBe(42);

    const pending = await db.selectFrom("sync_write_queue").selectAll().execute();
    expect(pending?.[0]?.hiveId).toBe(HIVE_ID);
  });

  it.each([
    { fraction: 0, status: WANTTOREAD, expected: WANTTOREAD, percent: 0 },
    { fraction: 0.42, status: READING, expected: READING, percent: 42 },
    { fraction: 0.99, status: WANTTOREAD, expected: READING, percent: 99 },
    { fraction: 1, status: WANTTOREAD, expected: FINISHED, percent: 100 },
    { fraction: 1, status: READING, expected: FINISHED, percent: 100 },
    { fraction: 0.999, status: READING, expected: FINISHED, percent: 100 },
    { fraction: 1, status: ABANDONED, expected: ABANDONED, percent: 100 },
    { fraction: 0.42, status: FINISHED, expected: FINISHED, percent: 42 },
  ])(
    "infers $status at $fraction as $expected using queued progress",
    async ({ fraction, status, expected, percent }) => {
      await db.updateTable("user_book").set({ status }).where("uri", "=", URI).execute();

      await bridgeProgressToUserBook(db, DID, HIVE_ID, fraction);

      const row = await readUserBook();
      expect(row?.status).toBe(expected);
      expect(JSON.parse(row?.bookProgress ?? "{}").percent).toBe(percent);
      const pending = await db.selectFrom("sync_write_queue").selectAll().execute();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.bookProgress).toBe(row?.bookProgress ?? "");
    },
  );

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

    await bridgeProgressToUserBook(db, DID, NO_HIVE_MATCH, 0.9);

    const row = await db
      .selectFrom("user_book")
      .select(["status", "bookProgress"])
      .where("uri", "=", sentinelUri)
      .executeTakeFirst();
    expect(row?.status).toBe(WANTTOREAD);
    expect(row?.bookProgress).toBeNull();
    expect(await db.selectFrom("sync_write_queue").selectAll().execute()).toEqual([]);
  });

  it("no-ops when the user does not track the book", async () => {
    await bridgeProgressToUserBook(db, DID, "bk_untracked" as HiveId, 0.5);
    expect(await db.selectFrom("sync_write_queue").selectAll().execute()).toEqual([]);
  });

  it("rolls back optimistic progress if durable enqueue fails", async () => {
    const { sql } = await import("kysely");
    await sql`CREATE TRIGGER reject_sync_write BEFORE INSERT ON sync_write_queue
      BEGIN SELECT RAISE(ABORT, 'queue unavailable'); END`.execute(db);
    expect(bridgeProgressToUserBook(db, DID, HIVE_ID, 0.5)).rejects.toThrow("queue unavailable");
    expect(await readUserBook()).toEqual({ status: WANTTOREAD, bookProgress: null });
  });
});
