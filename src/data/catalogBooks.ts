import { sql, type Expression, type SqlBool } from "kysely";

import type { Database } from "../db";
import type { HiveBook, HiveId } from "../types";
import { calculatePagination, pageOffset } from "../lib/pagination";
import { ftsMatchQuery, isUsefulFtsQuery } from "../core/ftsQuery";

/**
 * **The one** "list catalogue books by author or genre" — `/authors/:author`,
 * `/explore/genres/:genre`, XRPC `getAuthorBooks` and the genre branch of
 * XRPC `searchBooks` all use this rather than their own copies.
 *
 * Every sort ends on `hive_book.id` as a unique tiebreaker. Counting goes
 * against the join table alone whenever it can — it's index-only there, and
 * migration 020's triggers guarantee every join-table row has a book.
 */

export type CatalogSort = "popularity" | "relevance" | "reviews";

export type CatalogPage = {
  books: HiveBook[];
  totalBooks: number;
  totalPages: number;
  currentPage: number;
};

/** Matching-language books sort first. Nothing is filtered out. */
function languagePreference(language: string): Expression<number> {
  return sql<number>`CASE WHEN hive_book.language = ${language} THEN 0 ELSE 1 END`;
}

function finish(
  rows: HiveBook[],
  total: number | undefined,
  page: number,
  pageSize: number,
): CatalogPage {
  const totalBooks = Number(total ?? 0);
  const { totalPages, validPage } = calculatePagination(totalBooks, pageSize, page);
  return { books: rows, totalBooks, totalPages, currentPage: validPage };
}

export async function listBooksByAuthor({
  db,
  author,
  page,
  pageSize,
  sort,
  language,
}: {
  db: Database;
  author: string;
  page: number;
  pageSize: number;
  sort: CatalogSort;
  language?: string | undefined;
}): Promise<CatalogPage> {
  // Indexed join on hive_book_author (migration 020) rather than LIKE
  // patterns against the tab-separated `authors` column.
  let dataQuery = db
    .selectFrom("hive_book")
    .innerJoin("hive_book_author", "hive_book_author.hiveId", "hive_book.id")
    .where("hive_book_author.author", "=", author)
    .selectAll("hive_book")
    .$if(Boolean(language), (qb) => qb.orderBy(languagePreference(language!), "asc"));

  // `relevance` has no meaning for an author listing; it falls through to
  // popularity rather than silently producing a different order than the label.
  dataQuery =
    sort === "reviews"
      ? dataQuery.orderBy("hive_book.rating", "desc").orderBy("hive_book.ratingsCount", "desc")
      : dataQuery.orderBy("hive_book.ratingsCount", "desc").orderBy("hive_book.rating", "desc");

  const [count, books] = await Promise.all([
    db
      .selectFrom("hive_book_author")
      .select(sql<number>`COUNT(*)`.as("count"))
      .where("author", "=", author)
      .executeTakeFirst(),
    dataQuery
      .orderBy("hive_book.id", "asc")
      .limit(pageSize)
      .offset(pageOffset(page, pageSize))
      .execute(),
  ]);

  return finish(books, count?.count, page, pageSize);
}

export async function listBooksByGenre({
  db,
  genre,
  page,
  offset,
  pageSize,
  sort,
  language,
  q,
}: {
  db: Database;
  genre: string;
  page: number;
  /** Raw offset for cursor-style callers such as XRPC. Takes precedence over page. */
  offset?: number | undefined;
  pageSize: number;
  sort: CatalogSort;
  language?: string | undefined;
  /** Substring filter on title/authors. */
  q?: string | undefined;
}): Promise<CatalogPage> {
  // HTML uses numbered pages while XRPC's lexicon promises a raw offset. Keep
  // both transports on this query rather than rounding an arbitrary offset down
  // to a page boundary (which repeats earlier books).
  const queryOffset = offset ?? pageOffset(page, pageSize);
  const pattern = q ? `%${q}%` : null;
  const matchesQ = (eb: {
    or: (e: Expression<SqlBool>[]) => Expression<SqlBool>;
    (lhs: "hive_book.rawTitle" | "hive_book.authors", op: "like", rhs: string): Expression<SqlBool>;
  }) =>
    eb.or([eb("hive_book.rawTitle", "like", pattern!), eb("hive_book.authors", "like", pattern!)]);

  let dataQuery = db
    .selectFrom("hive_book")
    .innerJoin("hive_book_genre", "hive_book.id", "hive_book_genre.hiveId")
    .where("hive_book_genre.genre", "=", genre)
    .selectAll("hive_book")
    .$if(Boolean(pattern), (qb) => qb.where(matchesQ))
    .$if(Boolean(language), (qb) => qb.orderBy(languagePreference(language!), "asc"));

  switch (sort) {
    case "relevance":
      // Lower rowid ≈ earlier in the scraped genre list (syncHiveBookGenres
      // insert order). The UNIQUE (hiveId, genre) index guarantees exactly one
      // joined row per book, so the joined row's rowid is the ordering key —
      // no correlated subquery needed.
      dataQuery = dataQuery.orderBy(sql`hive_book_genre.rowid`, "asc");
      break;
    case "reviews":
      dataQuery = dataQuery
        .orderBy("hive_book.rating", "desc")
        .orderBy("hive_book.ratingsCount", "desc");
      break;
    default:
      dataQuery = dataQuery
        .orderBy("hive_book.ratingsCount", "desc")
        .orderBy("hive_book.rating", "desc");
  }

  // Without `q` the count is index-only on `hive_book_genre`. With it the
  // filter names `hive_book` columns, so the count has to join — but it must
  // match the data query's predicate exactly or the pager lies about the last
  // page.
  const countQuery = pattern
    ? db
        .selectFrom("hive_book_genre")
        .innerJoin("hive_book", "hive_book.id", "hive_book_genre.hiveId")
        .select(sql<number>`COUNT(*)`.as("count"))
        .where("hive_book_genre.genre", "=", genre)
        .where(matchesQ)
    : db
        .selectFrom("hive_book_genre")
        .select(sql<number>`COUNT(*)`.as("count"))
        .where("hive_book_genre.genre", "=", genre);

  const [count, books] = await Promise.all([
    countQuery.executeTakeFirst(),
    dataQuery.orderBy("hive_book.id", "asc").limit(pageSize).offset(queryOffset).execute(),
  ]);

  return finish(books, count?.count, page, pageSize);
}

/**
 * **The one** "which books in our catalogue match this string" — uses the
 * FTS5 index rather than an open-coded `LIKE '%…%'` scan.
 *
 * Returns ids in relevance order; pair with `hydrateSearchResults` for rows.
 */
export async function searchLocalCatalog({
  db,
  q,
  limit = 20,
  exclude = [],
}: {
  db: Database;
  q: string;
  limit?: number;
  /** Ids already found elsewhere, so the backfill does not repeat them. */
  exclude?: HiveId[];
}): Promise<HiveId[]> {
  const match = isUsefulFtsQuery(q) ? ftsMatchQuery(q) : null;
  if (!match || limit <= 0) return [];

  const rows = (
    await sql<{ id: HiveId }>`
      SELECT b.id
      FROM hive_book_fts f
      JOIN hive_book b ON b.rowid = f.rowid
      WHERE hive_book_fts MATCH ${match}
      ORDER BY b.ratingsCount DESC, b.rating DESC, b.id ASC
      LIMIT ${limit + exclude.length}
    `.execute(db)
  ).rows;

  const skip = new Set(exclude);
  const out: HiveId[] = [];
  for (const { id } of rows) {
    if (skip.has(id)) continue;
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Turn an ordered list of ids from `searchBooks` into rows, preserving search
 * relevance and sorting a preferred language to the front. Shared by
 * `/search` and XRPC `searchBooks` so the two can't disagree on truncation
 * order.
 */
export async function hydrateSearchResults({
  db,
  ids,
  language,
}: {
  db: Database;
  /** In relevance order. */
  ids: HiveId[];
  language?: string | undefined;
}): Promise<HiveBook[]> {
  if (!ids.length) return [];
  const rows = await db.selectFrom("hive_book").selectAll().where("id", "in", ids).execute();
  const rank = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => {
    if (language) {
      const aMatch = a.language === language ? 0 : 1;
      const bMatch = b.language === language ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
  });
}
