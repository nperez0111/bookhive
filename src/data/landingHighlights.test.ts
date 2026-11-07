import { afterEach, beforeEach, expect, it } from "bun:test";
import type { Database as Sqlite } from "bun:sqlite";
import { BookFields, type Database } from "../db";
import { createTestDb } from "../test/db";
import { buildRecentActivityQuery } from "./landingHighlights";

let db: Database;
let sqlite: Sqlite;
beforeEach(async () => {
  ({ db, sqlite } = await createTestDb());
});
afterEach(async () => {
  await db.destroy();
});

it("limits the creation-date index scan before joining books", async () => {
  const query = buildRecentActivityQuery(db, 10).compile();
  const plan = (
    sqlite.query(`EXPLAIN QUERY PLAN ${query.sql}`).all(...(query.parameters as never[])) as {
      detail: string;
    }[]
  )
    .map(({ detail }) => detail)
    .join("\n");
  expect(plan).toContain("idx_user_book_created_at");
  expect(plan).not.toContain("idx_user_book_hive_feed");
  for (let i = 0; i < 15; i++) {
    sqlite.exec(
      `INSERT INTO user_book (uri, cid, userDid, hiveId, title, authors, createdAt, indexedAt)
      VALUES (?, 'cid', 'did:plc:test', 'bk_missing', 'Title', 'Author', ?, ?)`,
      [
        `at://test/${String(i).padStart(2, "0")}`,
        i < 5 ? "2026-01-01" : "2026-02-01",
        `2026-03-${String(15 - i).padStart(2, "0")}`,
      ],
    );
  }
  const expected = await db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .orderBy("user_book.createdAt", "desc")
    .orderBy("user_book.uri", "desc")
    .limit(10)
    .execute();
  expect(await buildRecentActivityQuery(db, 10).execute()).toEqual(expected);
  expect(expected[0]?.uri).toBe("at://test/14");
  expect(expected[0]?.cover).toBeNull();
});
