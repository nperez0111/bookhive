/**
 * Author aggregates for `/explore`, `/explore/authors` and XRPC `getExplore`.
 * Caching lives *inside* these functions so the three consumers can't drift
 * into separate cache policies again.
 *
 * Two things here are load-bearing and easy to undo by accident:
 *
 * - `INDEXED BY idx_hive_book_stats` (migration 024) — without the hint the
 *   planner picks the UNIQUE autoindex on `b.id = ?` and fetches the whole
 *   row instead of the covering index, since this DB has no `sqlite_stat1`.
 * - `ORDER BY totalRatings DESC, author ASC` — the tiebreak is what makes
 *   `getFeaturedAuthors` a provable prefix of `getAuthorStats`, and keeps
 *   the rendered HTML byte-stable across worker processes.
 */
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import { readThroughCache } from "../lib/readThroughCache";

export interface AuthorStats {
  author: string;
  totalRatings: number;
  avgRating: number | null;
  bookCount: number;
}

export interface AuthorWithStats extends AuthorStats {
  thumbnail: string | null;
}

/** Rows in the `/explore/authors` directory list. */
export const AUTHOR_DIRECTORY_LIMIT = 500;

/** Books considered per author when resolving a featured cover. */
const THUMBNAIL_CANDIDATES_PER_AUTHOR = 5;

/**
 * 24h TTL with revalidation at 1h: after the first fill no request ever blocks
 * on the aggregate again, it is refreshed in the background. Plain TTLs made
 * every expiry a synchronous cliff on whichever worker drew the short straw.
 */
const CACHE_OPTS = { ttl: 86_400_000, revalidateAfter: 3_600_000 } as const;

/** Bump the `v1` when the shape of a cached value changes — nothing evicts
 * non-`page:` KV keys, so an old shape would be served for the full TTL. */
const STATS_KEY = (lang: string) => `authors:stats:v1:${lang}`;
const FEATURED_KEY = (lang: string, limit: number) => `authors:featured:v1:${lang}:${limit}`;

/**
 * Top authors by summed ratings, one row per credited first author.
 *
 * Groups the normalized `hive_book_author` table (migration 020) rather than
 * re-deriving the first author with instr/substr/trim over `hive_book.authors`.
 * `position = 0` is the credited first author.
 */
async function queryAuthorStats(db: Database, language?: string): Promise<AuthorStats[]> {
  const langCondition = language ? sql`AND b.language = ${language}` : sql``;
  const result = await sql<AuthorStats>`
    SELECT
      a.author as author,
      SUM(COALESCE(b.ratingsCount, 0)) as totalRatings,
      ROUND(AVG(CASE WHEN b.rating IS NOT NULL AND b.rating > 0 THEN b.rating END) / 1000.0, 1) as avgRating,
      COUNT(*) as bookCount
    FROM hive_book_author a
    JOIN hive_book b INDEXED BY idx_hive_book_stats ON b.id = a.hiveId
    WHERE a.position = 0 ${langCondition}
    GROUP BY a.author
    HAVING bookCount >= 2 AND totalRatings > 0
    ORDER BY totalRatings DESC, a.author ASC
    LIMIT ${AUTHOR_DIRECTORY_LIMIT}
  `.execute(db);
  return result.rows;
}

/**
 * Resolve one cover per author, ranked per-author by `ratingsCount` rather
 * than globally — a global top-N scan misses authors who rank highly on
 * summed ratings across many mid-tier books.
 *
 * The CTE is index-only on both sides; only the surviving handful of ids are
 * fetched from the table for their `thumbnail`. Empty-string thumbnails are
 * filtered in JS across the ranked candidates.
 */
async function queryThumbnails(
  db: Database,
  authors: string[],
  language?: string,
): Promise<Map<string, string>> {
  const byAuthor = new Map<string, string>();
  if (authors.length === 0) return byAuthor;

  const langCondition = language ? sql`AND b.language = ${language}` : sql``;
  const authorList = sql.join(
    authors.map((a) => sql`${a}`),
    sql`, `,
  );

  const result = await sql<{ author: string; thumbnail: string | null }>`
    WITH ranked AS (
      SELECT
        a.author as author,
        a.hiveId as hiveId,
        ROW_NUMBER() OVER (PARTITION BY a.author ORDER BY b.ratingsCount DESC) as rn
      FROM hive_book_author a
      JOIN hive_book b INDEXED BY idx_hive_book_stats ON b.id = a.hiveId
      WHERE a.position = 0 AND a.author IN (${authorList}) ${langCondition}
    )
    SELECT r.author as author, h.thumbnail as thumbnail
    FROM ranked r
    JOIN hive_book h ON h.id = r.hiveId
    WHERE r.rn <= ${THUMBNAIL_CANDIDATES_PER_AUTHOR}
    ORDER BY r.author ASC, r.rn ASC
  `.execute(db);

  for (const row of result.rows) {
    if (row.thumbnail && !byAuthor.has(row.author)) {
      byAuthor.set(row.author, row.thumbnail);
    }
  }
  return byAuthor;
}

/**
 * The full author directory list (top {@link AUTHOR_DIRECTORY_LIMIT} by summed
 * ratings), cached with stale-while-revalidate.
 */
export function getAuthorStats(
  db: Database,
  kv: Storage,
  language?: string,
): Promise<AuthorStats[]> {
  return readThroughCache<AuthorStats[]>(
    kv as Storage<AuthorStats[]>,
    STATS_KEY(language || "all"),
    () => queryAuthorStats(db, language),
    [],
    CACHE_OPTS,
  );
}

/**
 * The featured row: the top `limit` of {@link getAuthorStats} plus a cover.
 *
 * A strict prefix of the directory list rather than its own aggregate — the
 * `HAVING` clause and ordering are identical, so the two used to be the same
 * 356k-row `GROUP BY` executed twice per render of `/explore/authors`.
 */
export function getFeaturedAuthors(
  db: Database,
  kv: Storage,
  limit: number,
  language?: string,
): Promise<AuthorWithStats[]> {
  return readThroughCache<AuthorWithStats[]>(
    kv as Storage<AuthorWithStats[]>,
    FEATURED_KEY(language || "all", limit),
    async () => {
      const top = (await getAuthorStats(db, kv, language)).slice(0, limit);
      if (top.length === 0) return [];
      const thumbnails = await queryThumbnails(
        db,
        top.map((a) => a.author),
        language,
      );
      return top.map((a) => ({ ...a, thumbnail: thumbnails.get(a.author) ?? null }));
    },
    [],
    CACHE_OPTS,
  );
}
