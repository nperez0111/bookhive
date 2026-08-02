/**
 * hive_book_author (migration 020) — the normalized replacement for matching
 * four LIKE patterns against the tab-separated `hive_book.authors` column.
 *
 * The table is trigger-maintained, so these tests are as much about the
 * triggers as the schema: a helper that has to be called by hand would only
 * need to be forgotten at one of the ingester / importer / enrichment /
 * catalog-service write sites to silently desynchronize the index.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";

import { wrapBunSqliteForKysely } from "./bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "./db";

let db: Database;
let sqlite: DatabaseSync;

beforeEach(async () => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
});

afterEach(async () => {
  await db.destroy();
});

function insertBook(id: string, authors: string, ratingsCount = 0) {
  sqlite.exec(
    `INSERT INTO hive_book (id, title, rawTitle, authors, source, thumbnail, ratingsCount, createdAt, updatedAt)
     VALUES (?1, ?2, ?2, ?3, 'goodreads', '', ?4, ?5, ?5)`,
    [id, `Title ${id}`, authors, ratingsCount, new Date().toISOString()],
  );
}

const authorsOf = (hiveId: string) =>
  sqlite
    .query("SELECT author, position FROM hive_book_author WHERE hiveId = ?1 ORDER BY position")
    .all(hiveId) as Array<{ author: string; position: number }>;

const booksBy = (author: string) =>
  (
    sqlite
      .query("SELECT hiveId FROM hive_book_author WHERE author = ?1 ORDER BY hiveId")
      .all(author) as Array<{ hiveId: string }>
  ).map((r) => r.hiveId);

describe("hive_book_author triggers", () => {
  it("splits a tab-separated list into positioned rows", () => {
    insertBook("bk_1", "Neil Gaiman\tTerry Pratchett");
    expect(authorsOf("bk_1")).toEqual([
      { author: "Neil Gaiman", position: 0 },
      { author: "Terry Pratchett", position: 1 },
    ]);
  });

  it("trims surrounding whitespace", () => {
    insertBook("bk_2", "  Ursula K. Le Guin  ");
    expect(authorsOf("bk_2")).toEqual([{ author: "Ursula K. Le Guin", position: 0 }]);
  });

  it("skips empty segments from stray tabs", () => {
    insertBook("bk_3", "A\t\tB\t");
    expect(authorsOf("bk_3")).toEqual([
      { author: "A", position: 0 },
      { author: "B", position: 2 },
    ]);
  });

  it("rewrites the rows when authors change", () => {
    insertBook("bk_4", "Old One\tOld Two");
    sqlite.exec("UPDATE hive_book SET authors = ?1 WHERE id = ?2", ["New Sole", "bk_4"]);
    expect(authorsOf("bk_4")).toEqual([{ author: "New Sole", position: 0 }]);
  });

  it("leaves rows alone when an unrelated column is updated", () => {
    // Enrichment rewrites whole hive_book rows constantly; re-splitting on
    // every ratings update would be pure write amplification.
    insertBook("bk_5", "Stable Author\tSecond Author");
    sqlite.exec("UPDATE hive_book SET ratingsCount = 99 WHERE id = ?1", ["bk_5"]);
    expect(authorsOf("bk_5")).toHaveLength(2);
  });

  it("removes rows when the book is deleted", () => {
    insertBook("bk_6", "Gone Author");
    sqlite.exec("DELETE FROM hive_book WHERE id = ?1", ["bk_6"]);
    expect(authorsOf("bk_6")).toEqual([]);
  });

  it("handles a book credited to the same author twice", () => {
    // PRIMARY KEY(hiveId, author) collapses the duplicate rather than failing
    // the whole INSERT and losing the book.
    insertBook("bk_7", "Dupe\tDupe");
    expect(authorsOf("bk_7")).toEqual([{ author: "Dupe", position: 0 }]);
  });
});

describe("hive_book_author lookups match the LIKE patterns they replaced", () => {
  // The four patterns were: exact, `A\t%` (first), `%\tA\t%` (middle), `%\tA`
  // (last). Every position must still be found, and no false positives.
  beforeEach(() => {
    insertBook("bk_sole", "Target Author");
    insertBook("bk_first", "Target Author\tOther");
    insertBook("bk_middle", "Other\tTarget Author\tThird");
    insertBook("bk_last", "Other\tTarget Author");
    insertBook("bk_substring", "Target Authorship"); // must NOT match
    insertBook("bk_prefix", "Not Target Author Jr"); // must NOT match
  });

  it("finds the author in every position", () => {
    expect(booksBy("Target Author")).toEqual(["bk_first", "bk_last", "bk_middle", "bk_sole"]);
  });

  it("does not match authors that merely contain the name", () => {
    // This is why FTS5 was the wrong tool here: author lookup is exact
    // identity, not text search.
    expect(booksBy("Target Author")).not.toContain("bk_substring");
    expect(booksBy("Target Author")).not.toContain("bk_prefix");
  });

  it("distinguishes the credited first author for the directory", () => {
    const firsts = (
      sqlite
        .query("SELECT hiveId FROM hive_book_author WHERE author = ?1 AND position = 0")
        .all("Target Author") as Array<{ hiveId: string }>
    ).map((r) => r.hiveId);
    expect(firsts.sort()).toEqual(["bk_first", "bk_sole"]);
  });
});
