import { describe, expect, it } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type DatabaseSchema } from "../db";
import { findHiveBookMatch } from "./findHiveBookMatch";

async function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return { db, sqlite };
}

function seedHiveBook(
  sqlite: DatabaseSync,
  args: { id: string; rawTitle: string; title?: string; authors: string },
) {
  sqlite
    .prepare(
      `INSERT INTO hive_book (id, title, rawTitle, authors, cover, thumbnail, source, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NULL, '', 'goodreads', datetime('now'), datetime('now'))`,
    )
    .run(args.id, args.title ?? args.rawTitle, args.rawTitle, args.authors);
}

function seedIdMap(
  sqlite: DatabaseSync,
  args: {
    hiveId: string;
    isbn?: string | null;
    isbn13?: string | null;
    goodreadsId?: string | null;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO book_id_map (hiveId, isbn, isbn13, goodreadsId, updatedAt)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .run(args.hiveId, args.isbn ?? null, args.isbn13 ?? null, args.goodreadsId ?? null);
}

describe("findHiveBookMatch", () => {
  it("returns the exact match when title and author both line up", async () => {
    const { db, sqlite } = await makeDb();
    seedHiveBook(sqlite, {
      id: "bk_exact",
      rawTitle: "Foundation",
      authors: "Isaac Asimov",
    });

    const result = await findHiveBookMatch(db, {
      title: "Foundation",
      author: "Isaac Asimov",
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("bk_exact");
    expect(result!.matchedBy).toBe("exact");
  });

  it("falls back to ISBN-13 when title/author miss", async () => {
    const { db, sqlite } = await makeDb();
    seedHiveBook(sqlite, {
      id: "bk_isbn",
      rawTitle: "Foundation (different edition)",
      authors: "Isaac Asimov",
    });
    seedIdMap(sqlite, { hiveId: "bk_isbn", isbn13: "9780553293357" });

    const result = await findHiveBookMatch(db, {
      title: "Foundation",
      author: "Asimov, Isaac",
      isbn13: "978-0-553-29335-7",
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("bk_isbn");
    expect(result!.matchedBy).toBe("isbn13");
  });

  it("falls back to fuzzy when only an author casing differs", async () => {
    const { db, sqlite } = await makeDb();
    seedHiveBook(sqlite, {
      id: "bk_fuzzy",
      rawTitle: "The Great Gatsby",
      authors: "F. Scott Fitzgerald",
    });

    const result = await findHiveBookMatch(db, {
      title: "the great gatsby",
      author: "F Scott Fitzgerald",
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("bk_fuzzy");
    expect(result!.matchedBy).toBe("fuzzy");
  });

  it("does NOT match a series-mate via fuzzy fallback", async () => {
    const { db, sqlite } = await makeDb();
    // Only "Children of Ruin" exists; the importer is searching for
    // "Children of Time". The contentWordsMatch gate must reject.
    seedHiveBook(sqlite, {
      id: "bk_ruin",
      rawTitle: "Children of Ruin",
      authors: "Adrian Tchaikovsky",
    });

    const result = await findHiveBookMatch(db, {
      title: "Children of Time",
      author: "Adrian Tchaikovsky",
    });

    expect(result).toBeNull();
  });

  it("returns null when nothing matches", async () => {
    const { db } = await makeDb();
    const result = await findHiveBookMatch(db, {
      title: "A Book That Does Not Exist",
      author: "Nobody",
    });
    expect(result).toBeNull();
  });
});
