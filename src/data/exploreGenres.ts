/**
 * Genre aggregates for `/explore` and XRPC `getExplore`.
 *
 * Companion to `src/data/authorStats.ts` — same reasoning, same cache policy.
 *
 * The join is conditional: without a language filter it's a single index-only
 * scan of `idx_hive_book_genre_genre`, since joining `hive_book`
 * unconditionally would probe it for every row to produce a result the join
 * can't change.
 *
 * When a language is selected, the join needs `INDEXED BY idx_hive_book_stats`
 * — without the hint the planner takes the UNIQUE autoindex and fetches the
 * whole row just to read `language`.
 */
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import { readThroughCache } from "../lib/readThroughCache";

export interface GenreCount {
  genre: string;
  count: number;
}

/** Matches `src/data/authorStats.ts` — SWR so no request blocks on a refresh. */
const CACHE_OPTS = { ttl: 86_400_000, revalidateAfter: 3_600_000 } as const;

const GENRES_KEY = (lang: string, limit: number, minCount: number) =>
  `explore:genres:v2:${lang}:${limit}:${minCount}`;

async function queryTopGenres(
  db: Database,
  limit: number,
  language: string | undefined,
  minCount: number,
): Promise<GenreCount[]> {
  if (!language) {
    // Index-only scan of idx_hive_book_genre_genre(genre, hiveId).
    const result = await sql<GenreCount>`
      SELECT genre as genre, COUNT(*) as count
      FROM hive_book_genre
      GROUP BY genre
      HAVING COUNT(*) > ${minCount}
      ORDER BY COUNT(*) DESC, genre ASC
      LIMIT ${limit}
    `.execute(db);
    return result.rows;
  }

  const result = await sql<GenreCount>`
    SELECT g.genre as genre, COUNT(*) as count
    FROM hive_book_genre g
    JOIN hive_book b INDEXED BY idx_hive_book_stats ON b.id = g.hiveId
    WHERE b.language = ${language}
    GROUP BY g.genre
    HAVING COUNT(*) > ${minCount}
    ORDER BY COUNT(*) DESC, g.genre ASC
    LIMIT ${limit}
  `.execute(db);
  return result.rows;
}

/**
 * Most-populated genres, cached with stale-while-revalidate.
 *
 * `/explore/genres` used to run its own uncached copy of this aggregate that
 * disagreed on tiebreaking, the count floor, and language handling — the same
 * class of drift already fixed for `/explore/authors`.
 *
 * `minCount` is the floor, kept as a parameter rather than dropped silently.
 */
export function getTopGenres(
  db: Database,
  kv: Storage,
  limit: number,
  language?: string,
  minCount = 0,
): Promise<GenreCount[]> {
  return readThroughCache<GenreCount[]>(
    kv as Storage<GenreCount[]>,
    GENRES_KEY(language || "all", limit, minCount),
    () => queryTopGenres(db, limit, language, minCount),
    [],
    CACHE_OPTS,
  );
}
