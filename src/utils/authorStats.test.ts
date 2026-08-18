/**
 * Author/genre aggregates for the /explore family.
 *
 * The important tests here are the query-plan ones. `/explore/authors` took
 * 9-14.5s in production because these aggregates fetched the whole `hive_book`
 * row for every one of 356k books, and the covering index that fixes it is
 * *only* used because the queries name it with `INDEXED BY` — this database has
 * no `sqlite_stat1`, and without stats the planner prefers the UNIQUE
 * `sqlite_autoindex_hive_book_1` and goes straight back to the table. Nothing
 * about that failure mode is visible in the results, so it needs a test.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import { AUTHOR_DIRECTORY_LIMIT, getAuthorStats, getFeaturedAuthors } from "./authorStats";
import { getTopGenres } from "./exploreGenres";

let db: Database;
let sqlite: DatabaseSync;

const newKv = () => createStorage({ driver: memoryDriver() });

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

function insertBook(opts: {
  id: string;
  authors: string;
  ratingsCount?: number;
  rating?: number;
  thumbnail?: string;
  language?: string;
}) {
  sqlite.exec(
    `INSERT INTO hive_book (id, title, rawTitle, authors, source, thumbnail, ratingsCount, rating, language, createdAt, updatedAt)
     VALUES (?1, ?2, ?2, ?3, 'goodreads', ?4, ?5, ?6, ?7, ?8, ?8)`,
    [
      opts.id,
      `Title ${opts.id}`,
      opts.authors,
      opts.thumbnail ?? "",
      opts.ratingsCount ?? 0,
      opts.rating ?? null,
      opts.language ?? null,
      new Date().toISOString(),
    ],
  );
}

const indexNames = () =>
  (
    sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);

const plan = (query: string, params: unknown[] = []) =>
  (
    sqlite.query(`EXPLAIN QUERY PLAN ${query}`).all(...(params as never[])) as Array<{
      detail: string;
    }>
  )
    .map((r) => r.detail)
    .join("\n");

describe("migration 024", () => {
  it("creates the covering indexes and retires the prefix index", () => {
    const names = indexNames();
    expect(names).toContain("idx_hive_book_stats");
    expect(names).toContain("idx_hive_book_author_first_cover");
    // Strict prefix of idx_hive_book_author_first_cover; it has no other reader.
    expect(names).not.toContain("idx_hive_book_author_first");
  });

  it("keeps the index every other hive_book_author consumer uses", () => {
    // /authors/:author, bookInfo's "more by this author" and the OG renderer
    // all filter on `author` alone.
    expect(indexNames()).toContain("idx_hive_book_author_author");
  });
});

describe("author aggregate query plans", () => {
  // Guards the actual production regression: without `INDEXED BY` these say
  // `SEARCH b USING INDEX sqlite_autoindex_hive_book_1`, which means a fetch of
  // the whole row from a 1.62 GB table for every book in the catalogue.
  const AGGREGATE = `
    SELECT a.author, SUM(COALESCE(b.ratingsCount, 0)) as totalRatings, COUNT(*) as bookCount
    FROM hive_book_author a
    JOIN hive_book b INDEXED BY idx_hive_book_stats ON b.id = a.hiveId
    WHERE a.position = 0
    GROUP BY a.author`;

  it("is index-only on both sides", () => {
    const detail = plan(AGGREGATE);
    expect(detail).toContain("COVERING INDEX idx_hive_book_author_first_cover");
    expect(detail).toContain("COVERING INDEX idx_hive_book_stats");
    expect(detail).not.toContain("sqlite_autoindex_hive_book_1");
  });

  it("stays index-only when filtered by language", () => {
    const detail = plan(
      `${AGGREGATE.replace("WHERE a.position = 0", "WHERE a.position = 0 AND b.language = 'en'")}`,
    );
    expect(detail).toContain("COVERING INDEX idx_hive_book_stats");
    expect(detail).not.toContain("sqlite_autoindex_hive_book_1");
  });

  it("avoids the hive_book join entirely for the language-less genre list", () => {
    // /explore used to innerJoin hive_book unconditionally, paying a probe per
    // hive_book_genre row for a join that cannot change the result.
    const detail = plan(
      "SELECT genre, COUNT(*) as count FROM hive_book_genre GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 6",
    );
    expect(detail).toContain("COVERING INDEX idx_hive_book_genre_genre");
    expect(detail).not.toContain("hive_book ");
  });
});

describe("getAuthorStats", () => {
  beforeEach(() => {
    // Two books each so they clear `HAVING bookCount >= 2`.
    insertBook({ id: "bk_a1", authors: "Alpha Author", ratingsCount: 500, rating: 4200 });
    insertBook({ id: "bk_a2", authors: "Alpha Author", ratingsCount: 500, rating: 4400 });
    insertBook({ id: "bk_b1", authors: "Beta Author", ratingsCount: 100 });
    insertBook({ id: "bk_b2", authors: "Beta Author", ratingsCount: 100 });
  });

  it("ranks by summed ratings and aggregates per first author", async () => {
    const stats = await getAuthorStats(db, newKv());
    expect(stats.map((s) => s.author)).toEqual(["Alpha Author", "Beta Author"]);
    expect(stats[0]).toMatchObject({ totalRatings: 1000, bookCount: 2, avgRating: 4.3 });
  });

  it("excludes authors with a single book or no ratings", async () => {
    insertBook({ id: "bk_solo", authors: "Solo Author", ratingsCount: 9999 });
    insertBook({ id: "bk_z1", authors: "Zero Author", ratingsCount: 0 });
    insertBook({ id: "bk_z2", authors: "Zero Author", ratingsCount: 0 });

    const authors = (await getAuthorStats(db, newKv())).map((s) => s.author);
    expect(authors).not.toContain("Solo Author");
    expect(authors).not.toContain("Zero Author");
  });

  it("only counts the credited first author", async () => {
    insertBook({ id: "bk_c1", authors: "Lead\tSidekick", ratingsCount: 300 });
    insertBook({ id: "bk_c2", authors: "Lead\tSidekick", ratingsCount: 300 });

    const authors = (await getAuthorStats(db, newKv())).map((s) => s.author);
    expect(authors).toContain("Lead");
    expect(authors).not.toContain("Sidekick");
  });

  it("filters by language when one is given", async () => {
    insertBook({ id: "bk_f1", authors: "French Author", ratingsCount: 700, language: "French" });
    insertBook({ id: "bk_f2", authors: "French Author", ratingsCount: 700, language: "French" });

    const french = await getAuthorStats(db, newKv(), "French");
    expect(french.map((s) => s.author)).toEqual(["French Author"]);
    // Alpha/Beta have no language, so they must not leak into the filtered list.
    expect(french).toHaveLength(1);
  });

  it("breaks ties deterministically by author name", async () => {
    // Without the tiebreak, SQLite may order a tied group differently under two
    // different LIMITs — which is what makes the featured slice below valid.
    insertBook({ id: "bk_t1", authors: "Tie Zulu", ratingsCount: 50 });
    insertBook({ id: "bk_t2", authors: "Tie Zulu", ratingsCount: 50 });
    insertBook({ id: "bk_t3", authors: "Tie Alpha", ratingsCount: 50 });
    insertBook({ id: "bk_t4", authors: "Tie Alpha", ratingsCount: 50 });

    const tied = (await getAuthorStats(db, newKv())).filter((s) => s.author.startsWith("Tie "));
    expect(tied.map((s) => s.author)).toEqual(["Tie Alpha", "Tie Zulu"]);
  });

  it("caps the directory list", async () => {
    expect(AUTHOR_DIRECTORY_LIMIT).toBe(500);
  });

  it("serves the second call from cache", async () => {
    const kv = newKv();
    await getAuthorStats(db, kv);
    // Rows added after the fill must not appear until the entry is refreshed.
    insertBook({ id: "bk_n1", authors: "New Author", ratingsCount: 99999 });
    insertBook({ id: "bk_n2", authors: "New Author", ratingsCount: 99999 });
    const second = await getAuthorStats(db, kv);
    expect(second.map((s) => s.author)).not.toContain("New Author");
  });
});

describe("getFeaturedAuthors", () => {
  beforeEach(() => {
    for (let i = 0; i < 12; i++) {
      const ratings = (12 - i) * 100;
      insertBook({
        id: `bk_x${i}a`,
        authors: `Author ${String(i).padStart(2, "0")}`,
        ratingsCount: ratings,
        thumbnail: `https://covers.example/${i}-low.jpg`,
      });
      insertBook({
        id: `bk_x${i}b`,
        authors: `Author ${String(i).padStart(2, "0")}`,
        ratingsCount: ratings + 1,
        thumbnail: `https://covers.example/${i}-high.jpg`,
      });
    }
  });

  it("is a strict prefix of getAuthorStats", async () => {
    // The whole point of the refactor: /explore/authors ran the same 356k-row
    // GROUP BY twice per render, once at LIMIT 8 and once at LIMIT 500.
    const kv = newKv();
    const [featured, all] = await Promise.all([
      getFeaturedAuthors(db, kv, 8),
      getAuthorStats(db, kv),
    ]);
    expect(featured).toHaveLength(8);
    expect(featured.map(({ thumbnail: _t, ...rest }) => rest)).toEqual(all.slice(0, 8));
  });

  it("picks each author's most-rated cover", async () => {
    const featured = await getFeaturedAuthors(db, newKv(), 1);
    expect(featured[0]?.thumbnail).toBe("https://covers.example/0-high.jpg");
  });

  it("falls back to null when the candidates have no cover", async () => {
    insertBook({ id: "bk_nc1", authors: "Coverless", ratingsCount: 999999, thumbnail: "" });
    insertBook({ id: "bk_nc2", authors: "Coverless", ratingsCount: 999999, thumbnail: "" });

    const featured = await getFeaturedAuthors(db, newKv(), 1);
    expect(featured[0]?.author).toBe("Coverless");
    expect(featured[0]?.thumbnail).toBeNull();
  });

  it("handles author names containing quotes", async () => {
    // The IN list is bound, not interpolated — an apostrophe here would be a
    // syntax error if that ever regressed.
    insertBook({ id: "bk_q1", authors: "Patrick O'Brian", ratingsCount: 999999 });
    insertBook({ id: "bk_q2", authors: "Patrick O'Brian", ratingsCount: 999999 });

    const featured = await getFeaturedAuthors(db, newKv(), 1);
    expect(featured[0]?.author).toBe("Patrick O'Brian");
  });

  it("returns an empty list when there are no qualifying authors", async () => {
    sqlite.exec("DELETE FROM hive_book");
    expect(await getFeaturedAuthors(db, newKv(), 8)).toEqual([]);
  });
});

describe("getTopGenres", () => {
  beforeEach(() => {
    insertBook({ id: "bk_g1", authors: "A", language: "English" });
    insertBook({ id: "bk_g2", authors: "B", language: "English" });
    insertBook({ id: "bk_g3", authors: "C", language: "French" });
    sqlite.exec(
      `INSERT INTO hive_book_genre (hiveId, genre) VALUES
        ('bk_g1', 'Fantasy'), ('bk_g2', 'Fantasy'), ('bk_g3', 'Fantasy'), ('bk_g3', 'Poetry')`,
    );
  });

  it("counts every book when no language is given", async () => {
    const genres = await getTopGenres(db, newKv(), 6);
    expect(genres).toEqual([
      { genre: "Fantasy", count: 3 },
      { genre: "Poetry", count: 1 },
    ]);
  });

  it("counts only the selected language when one is given", async () => {
    expect(await getTopGenres(db, newKv(), 6, "English")).toEqual([{ genre: "Fantasy", count: 2 }]);
  });

  it("keys the cache by language", async () => {
    const kv = newKv();
    await getTopGenres(db, kv, 6);
    expect(await getTopGenres(db, kv, 6, "French")).toEqual([
      { genre: "Fantasy", count: 1 },
      { genre: "Poetry", count: 1 },
    ]);
  });
});
