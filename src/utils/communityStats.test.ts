import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database as Sqlite } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import type { Database, DatabaseSchema } from "../db";
import { FINISHED, READING } from "../constants";
import { getCommunityStats } from "./communityStats";

let sqlite: Sqlite;
let db: Database;

beforeEach(() => {
  sqlite = new Sqlite(":memory:");
  sqlite.exec(
    "CREATE TABLE user_book (userDid TEXT, hiveId TEXT, status TEXT, stars INTEGER, finishedAt TEXT)",
  );
  db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
});

afterEach(async () => {
  await db.destroy();
});

describe("community statistics", () => {
  it("counts readers distinctly and shelf entries individually, excluding owned-only rows", async () => {
    const insert = sqlite.prepare(
      "INSERT INTO user_book (userDid, hiveId, status, stars) VALUES (?, ?, ?, ?)",
    );
    insert.run("alice", "same-book", FINISHED, 8);
    insert.run("bob", "same-book", FINISHED, null);
    insert.run("alice", "another-book", READING, 0);
    insert.run("owned-only", "other", null, 10);
    expect(await getCommunityStats(db, createStorage())).toEqual({
      readers: 2,
      booksTracked: 3,
      booksFinishedLastWeek: 0,
    });
  });

  it("caches even an empty hive for a full day without re-querying the database", async () => {
    const kv = createStorage();
    const empty = {
      readers: 0,
      booksTracked: 0,
      booksFinishedLastWeek: 0,
    };
    expect(await getCommunityStats(db, kv)).toEqual(empty);
    await kv.setMeta("stats:community:v2", { timestamp: Date.now() - 23 * 3_600_000 });
    sqlite.exec("DROP TABLE user_book");
    expect(await getCommunityStats(db, kv)).toEqual(empty);
  });

  it("omits stats on a cold aggregate failure rather than displaying fabricated zeros", async () => {
    sqlite.exec("DROP TABLE user_book");
    expect(await getCommunityStats(db, createStorage())).toBeNull();
  });

  it("counts recent finish dates, excluding old, future, missing and unfinished entries", async () => {
    const insert = sqlite.prepare("INSERT INTO user_book VALUES ('alice', 'book', ?, NULL, ?)");
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    insert.run(FINISHED, daysAgo(1));
    insert.run(FINISHED, daysAgo(2).slice(0, 10));
    insert.run(FINISHED, daysAgo(8));
    insert.run(FINISHED, daysAgo(-1));
    insert.run(FINISHED, null);
    insert.run(FINISHED, "invalid");
    insert.run(READING, daysAgo(1));
    const stats = await getCommunityStats(db, createStorage());
    expect(stats?.booksFinishedLastWeek).toBe(2);
  });
});
