/**
 * The catalogue listings behind `/authors/:author`, `/explore/genres/:genre`
 * and their two XRPC twins.
 *
 * The pagination tests matter most here: all four callers used to page with
 * OFFSET over an ORDER BY ending on `ratingsCount, rating` — neither unique —
 * so SQLite could order ties differently between two queries and page 2 could
 * repeat or drop a book with nothing visible in a single page's results.
 */
import type { Database as DatabaseSync } from "bun:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "../test/db";

import type { Database } from "../db";
import type { HiveId } from "../types";
import {
  hydrateSearchResults,
  listBooksByAuthor,
  listBooksByGenre,
  searchLocalCatalog,
} from "./catalogBooks";

let db: Database;
let sqlite: DatabaseSync;

beforeEach(async () => {
  ({ db, sqlite } = await createTestDb());
});

afterEach(async () => {
  await db.destroy();
});

/** The `hive_book_author` rows come from migration 020's insert trigger. */
function insertBook(opts: {
  id: string;
  title?: string;
  authors: string;
  ratingsCount?: number;
  rating?: number;
  language?: string | null;
}) {
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO hive_book (id, title, rawTitle, authors, source, thumbnail, ratingsCount, rating, language, createdAt, updatedAt)
     VALUES (?1, ?2, ?2, ?3, 'goodreads', '', ?4, ?5, ?6, ?7, ?7)`,
    [
      opts.id,
      opts.title ?? `Title ${opts.id}`,
      opts.authors,
      opts.ratingsCount ?? 0,
      opts.rating ?? null,
      opts.language ?? null,
      now,
    ],
  );
}

function addGenre(id: string, genre: string) {
  sqlite.exec(`INSERT INTO hive_book_genre (hiveId, genre) VALUES (?1, ?2)`, [id, genre]);
}

const plan = (query: string) =>
  (sqlite.query(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{ detail: string }>)
    .map((r) => r.detail)
    .join("\n");

describe("listBooksByAuthor", () => {
  it("pages without repeating or dropping a book when every sort key ties", async () => {
    // Identical ratingsCount and rating on every row, so only the final unique key decides order.
    for (let i = 0; i < 10; i++) {
      insertBook({ id: `bk_${String(i).padStart(2, "0")}`, authors: "Ursula K. Le Guin" });
    }

    const args = { db, author: "Ursula K. Le Guin", pageSize: 4, sort: "popularity" as const };
    const p1 = await listBooksByAuthor({ ...args, page: 1 });
    const p2 = await listBooksByAuthor({ ...args, page: 2 });
    const p3 = await listBooksByAuthor({ ...args, page: 3 });

    const seen = [...p1.books, ...p2.books, ...p3.books].map((b) => b.id);
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
    expect(p1.totalBooks).toBe(10);
    expect(p1.totalPages).toBe(3);
  });

  it("matches the author exactly, not by substring", async () => {
    insertBook({ id: "bk_a", authors: "Kim Stanley Robinson" });
    insertBook({ id: "bk_b", authors: "Marilynne Robinson" });

    const res = await listBooksByAuthor({
      db,
      author: "Marilynne Robinson",
      page: 1,
      pageSize: 10,
      sort: "popularity",
    });
    expect(res.books.map((b) => b.id)).toEqual(["bk_b"]);
    expect(res.totalBooks).toBe(1);
  });

  it("finds an author the tab-separated column would not match with LIKE", async () => {
    // Migration 020's trigger stores trim(substr(...)), so "A\t B" yields the exact author "B" — which a LIKE '%\tB' pattern would never match.
    insertBook({ id: "bk_c", authors: "China Miéville\t Jeff VanderMeer" });

    const res = await listBooksByAuthor({
      db,
      author: "Jeff VanderMeer",
      page: 1,
      pageSize: 10,
      sort: "popularity",
    });
    expect(res.books.map((b) => b.id)).toEqual(["bk_c"]);
  });

  it("sorts a preferred language first without filtering the rest out", async () => {
    insertBook({ id: "bk_en", authors: "Jorge Luis Borges", language: "en" });
    insertBook({ id: "bk_es", authors: "Jorge Luis Borges", language: "es" });

    const res = await listBooksByAuthor({
      db,
      author: "Jorge Luis Borges",
      page: 1,
      pageSize: 10,
      sort: "popularity",
      language: "es",
    });
    expect(res.books.map((b) => b.id)).toEqual(["bk_es", "bk_en"]);
  });

  it("counts index-only on hive_book_author", () => {
    // The XRPC copy joined hive_book here, fetching a row per counted row for a number the index already has.
    const detail = plan(`SELECT COUNT(*) FROM hive_book_author WHERE author = 'x'`);
    expect(detail).toContain("idx_hive_book_author_author");
    expect(detail).not.toContain("hive_book ");
  });
});

describe("listBooksByGenre", () => {
  it("pages without repeating or dropping a book when every sort key ties", async () => {
    for (let i = 0; i < 7; i++) {
      const id = `bk_g${i}`;
      insertBook({ id, authors: "Anon" });
      addGenre(id, "Science Fiction");
    }

    const args = { db, genre: "Science Fiction", pageSize: 3, sort: "popularity" as const };
    const seen = [
      ...(await listBooksByGenre({ ...args, page: 1 })).books,
      ...(await listBooksByGenre({ ...args, page: 2 })).books,
      ...(await listBooksByGenre({ ...args, page: 3 })).books,
    ].map((b) => b.id);

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("honours a raw offset rather than rounding it down to a page boundary", async () => {
    for (let i = 0; i < 5; i++) {
      const id = `bk_o${i}`;
      insertBook({ id, authors: "Anon" });
      addGenre(id, "Science Fiction");
    }

    // The XRPC lexicon defines offset as an arbitrary index, not a multiple of
    // limit. With limit 2, offset 1 must begin at bk_o1 rather than bk_o0.
    const result = await listBooksByGenre({
      db,
      genre: "Science Fiction",
      page: 1,
      offset: 1,
      pageSize: 2,
      sort: "popularity",
    });

    expect(result.books.map((book) => book.id)).toEqual(["bk_o1", "bk_o2"]);
  });

  it("keeps the count and the data query on the same predicate when filtering", async () => {
    insertBook({ id: "bk_m1", title: "Dune", authors: "Frank Herbert" });
    insertBook({ id: "bk_m2", title: "Neuromancer", authors: "William Gibson" });
    addGenre("bk_m1", "Science Fiction");
    addGenre("bk_m2", "Science Fiction");

    const res = await listBooksByGenre({
      db,
      genre: "Science Fiction",
      page: 1,
      pageSize: 10,
      sort: "popularity",
      q: "Dune",
    });
    // A count that ignored `q` would report 2 and render a second page that
    // does not exist.
    expect(res.books.map((b) => b.id)).toEqual(["bk_m1"]);
    expect(res.totalBooks).toBe(1);
    expect(res.totalPages).toBe(1);
  });
});

describe("hydrateSearchResults", () => {
  it("preserves relevance order and never truncates before sorting", async () => {
    insertBook({ id: "bk_r1", authors: "A", language: "en" });
    insertBook({ id: "bk_r2", authors: "B", language: "fr" });
    insertBook({ id: "bk_r3", authors: "C", language: "en" });

    const ids = ["bk_r3", "bk_r1", "bk_r2"] as HiveId[];
    expect((await hydrateSearchResults({ db, ids })).map((b) => b.id)).toEqual(ids);

    // The preferred language wins over relevance, but only reorders — the
    // truncating copy this replaced could drop `bk_r2` before it ever sorted.
    expect((await hydrateSearchResults({ db, ids, language: "fr" })).map((b) => b.id)).toEqual([
      "bk_r2",
      "bk_r3",
      "bk_r1",
    ]);
  });

  it("returns nothing for an empty id list without querying", async () => {
    expect(await hydrateSearchResults({ db, ids: [] })).toEqual([]);
  });
});

/**
 * `searchLocalCatalog` replaced two `LIKE '%…%'` copies. The tests worth
 * having are the ones the LIKE version got wrong: which columns are
 * searched, and whether the index is actually used.
 */
describe("searchLocalCatalog", () => {
  it("matches on title, rawTitle and authors — the LIKE copies each picked one", () => {
    insertBook({ id: "bk_t", title: "Dune", authors: "Frank Herbert" });
    insertBook({ id: "bk_a", title: "Something Else", authors: "Ursula K. Le Guin" });

    return Promise.all([
      searchLocalCatalog({ db, q: "Dune" }),
      searchLocalCatalog({ db, q: "Le Guin" }),
    ]).then(([byTitle, byAuthor]) => {
      expect(byTitle).toEqual(["bk_t"] as HiveId[]);
      expect(byAuthor).toEqual(["bk_a"] as HiveId[]);
    });
  });

  it("orders by popularity and breaks ties on id", async () => {
    // All three tie on ratingsCount and rating, which is the common case across
    // the catalogue — without the `id` tiebreak the caller's `limit` takes an
    // arbitrary slice.
    for (const id of ["bk_c", "bk_a", "bk_b"]) {
      insertBook({ id, title: "Dune", authors: "Frank Herbert" });
    }
    expect(await searchLocalCatalog({ db, q: "Dune" })).toEqual([
      "bk_a",
      "bk_b",
      "bk_c",
    ] as HiveId[]);
  });

  it("honours `limit` after `exclude`, so a backfill returns a full page", async () => {
    for (const id of ["bk_a", "bk_b", "bk_c", "bk_d"]) {
      insertBook({ id, title: "Dune", authors: "Frank Herbert" });
    }
    // The XRPC backfill excludes what `searchBooks` already returned. Excluded
    // rows must not eat into the limit — that is why the SQL fetches
    // `limit + exclude.length`.
    const ids = await searchLocalCatalog({
      db,
      q: "Dune",
      limit: 2,
      exclude: ["bk_a", "bk_b"] as HiveId[],
    });
    expect(ids).toEqual(["bk_c", "bk_d"] as HiveId[]);
  });

  it("returns nothing for a query too short to be worth matching", async () => {
    insertBook({ id: "bk_a", title: "Dune", authors: "Frank Herbert" });
    // A one-character prefix matches nearly the whole corpus and costs about as
    // much as the scan it replaced, for arbitrary results.
    expect(await searchLocalCatalog({ db, q: "a" })).toEqual([]);
    expect(await searchLocalCatalog({ db, q: "   " })).toEqual([]);
    expect(await searchLocalCatalog({ db, q: "!!!" })).toEqual([]);
  });

  it("survives a quote in the query rather than throwing an FTS syntax error", async () => {
    insertBook({ id: "bk_a", title: "The Handmaid's Tale", authors: "Margaret Atwood" });
    // A bare `"` is FTS5 phrase syntax; unescaped it is a syntax error and the
    // query throws rather than returning nothing. Doubled, the tokenizer drops
    // it as a separator, so this still finds the book — which is the behaviour
    // we want and the reason `ftsMatchQuery` escapes rather than strips.
    expect(await searchLocalCatalog({ db, q: 'Handmaid"s' })).toEqual(["bk_a"] as HiveId[]);
    expect(await searchLocalCatalog({ db, q: "Handmaid's Tale" })).toEqual(["bk_a"] as HiveId[]);
  });

  it("uses the FTS index rather than scanning hive_book", () => {
    // A SCAN hive_book here is the regression coming back.
    const detail = plan(`
      SELECT b.id FROM hive_book_fts f
      JOIN hive_book b ON b.rowid = f.rowid
      WHERE hive_book_fts MATCH '"dune"*'
      ORDER BY b.ratingsCount DESC, b.rating DESC, b.id ASC
      LIMIT 20
    `);
    // The regression this guards is `SCAN b` — a full pass over hive_book.
    expect(detail).toContain("VIRTUAL TABLE");
    expect(detail).toContain("SEARCH b USING INTEGER PRIMARY KEY");
    expect(detail).not.toContain("SCAN b");
  });
});
