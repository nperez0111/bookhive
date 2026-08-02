import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect, sql } from "kysely";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import { ftsMatchQuery, isUsefulFtsQuery } from "./ftsQuery";

/**
 * Built by hand rather than via `createDb`, matching the other DB suites:
 * `createDb` reads `env`, and another test file in the shared process mocks
 * that module, which turns its PRAGMA values into `undefined`.
 */
async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

describe("ftsMatchQuery", () => {
  it("wraps input as a phrase with a trailing prefix", () => {
    // Phrase keeps the words adjacent, `*` keeps type-ahead working.
    expect(ftsMatchQuery("the girl")).toBe('"the girl"*');
    expect(ftsMatchQuery("harry pot")).toBe('"harry pot"*');
  });

  it("collapses surrounding and internal whitespace", () => {
    expect(ftsMatchQuery("  dune   messiah ")).toBe('"dune messiah"*');
  });

  it("doubles embedded quotes rather than emitting invalid syntax", () => {
    // An unescaped quote is an FTS5 syntax error, which throws instead of
    // returning nothing.
    expect(ftsMatchQuery('the "great" gatsby')).toBe('"the ""great"" gatsby"*');
  });

  it("returns null when there is nothing to match", () => {
    expect(ftsMatchQuery("")).toBeNull();
    expect(ftsMatchQuery("   ")).toBeNull();
    // Pure punctuation tokenizes to nothing and would match everything.
    expect(ftsMatchQuery("!!! ---")).toBeNull();
  });

  it("keeps queries that contain any letter or digit", () => {
    expect(ftsMatchQuery("1984")).toBe('"1984"*');
    expect(ftsMatchQuery("café")).toBe('"café"*');
  });
});

describe("isUsefulFtsQuery", () => {
  it("rejects single characters, which prefix-match the whole corpus", () => {
    expect(isUsefulFtsQuery("a")).toBe(false);
    expect(isUsefulFtsQuery(" a ")).toBe(false);
    expect(isUsefulFtsQuery("it")).toBe(true);
  });
});

describe("hive_book_fts (migration 019)", () => {
  let db: Database;

  const search = async (input: string) => {
    const match = ftsMatchQuery(input)!;
    const rows = await sql<{ id: string }>`
      SELECT b.id FROM hive_book_fts f JOIN hive_book b ON b.rowid = f.rowid
      WHERE hive_book_fts MATCH ${match}
      ORDER BY b.ratingsCount DESC
    `.execute(db);
    return rows.rows.map((r) => r.id);
  };

  const insert = (id: string, title: string, authors: string, ratingsCount = 0) =>
    db
      .insertInto("hive_book")
      .values({
        id: id as never,
        title,
        rawTitle: title,
        authors,
        ratingsCount,
        source: "goodreads",
        thumbnail: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never)
      .execute();

  beforeEach(async () => {
    db = await createTestDb();
    await insert("bk_1", "The Girl with the Dragon Tattoo", "Stieg Larsson", 100);
    await insert("bk_2", "The Diary of a Young Girl", "Anne Frank", 999);
    await insert("bk_3", "The Hobbit", "J.R.R. Tolkien", 50);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("requires phrase adjacency, matching the LIKE it replaced", async () => {
    // With an implicit AND, "the girl" would rank The Diary of a Young Girl
    // first purely on ratingsCount. The phrase form excludes it.
    expect(await search("the girl")).toEqual(["bk_1"]);
  });

  it("prefix-matches a half-typed final word", async () => {
    expect(await search("the hobb")).toEqual(["bk_3"]);
  });

  it("searches authors as well as titles", async () => {
    expect(await search("tolkien")).toEqual(["bk_3"]);
  });

  it("indexes rows inserted after the migration", async () => {
    await insert("bk_4", "Dune", "Frank Herbert", 10);
    expect(await search("dune")).toEqual(["bk_4"]);
  });

  it("reflects updates without leaving the old terms behind", async () => {
    await db
      .updateTable("hive_book")
      .set({ title: "Dune Messiah", rawTitle: "Dune Messiah" })
      .where("id", "=", "bk_3" as never)
      .execute();

    // Orphaned terms from the pre-update row would keep matching forever.
    expect(await search("hobbit")).toEqual([]);
    expect(await search("dune messiah")).toEqual(["bk_3"]);
  });

  it("drops terms for deleted rows", async () => {
    await db
      .deleteFrom("hive_book")
      .where("id", "=", "bk_1" as never)
      .execute();
    expect(await search("the girl")).toEqual([]);
  });

  it("treats quotes in the input as separators rather than throwing", async () => {
    // Escaped quotes end up inside the phrase, where FTS5 tokenizes them away.
    // The old LIKE '%the "girl"%' matched nothing at all here.
    expect(await search('the "girl"')).toEqual(["bk_1"]);
  });
});
