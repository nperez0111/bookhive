/**
 * Genre aggregates for `/explore` and XRPC `getExplore`.
 *
 * Companion to `src/utils/authorStats.ts` — same reasoning, same cache policy,
 * and the same reason for existing: `/explore` cached this with a 1h TTL while
 * the XRPC method ran it uncached on every mobile Explore open.
 *
 * The join is **conditional**. `/explore` used to `innerJoin hive_book`
 * unconditionally and only add the `WHERE language = ?` when a language was
 * selected, so the language-less case — which is nearly all of the traffic —
 * paid a B-tree probe for every one of the ~1-3M `hive_book_genre` rows to
 * produce a result the join could not change. Dropping it makes that case a
 * single index-only scan of `idx_hive_book_genre_genre` (migration 014).
 *
 * When a language *is* selected the join is real, and it needs
 * `INDEXED BY idx_hive_book_stats` for the same reason the author aggregates
 * do: without the hint the planner takes the UNIQUE autoindex and fetches the
 * whole row from the 1.62 GB table just to read `language`. See the migration
 * 024 docstring.
 */
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import { readThroughCache } from "./readThroughCache";

export interface GenreCount {
  genre: string;
  count: number;
}

/** Matches `src/utils/authorStats.ts` — SWR so no request blocks on a refresh. */
const CACHE_OPTS = { ttl: 86_400_000, revalidateAfter: 3_600_000 } as const;

const GENRES_KEY = (lang: string, limit: number) => `explore:genres:v1:${lang}:${limit}`;

async function queryTopGenres(
  db: Database,
  limit: number,
  language?: string,
): Promise<GenreCount[]> {
  if (!language) {
    // Index-only scan of idx_hive_book_genre_genre(genre, hiveId).
    const result = await sql<GenreCount>`
      SELECT genre as genre, COUNT(*) as count
      FROM hive_book_genre
      GROUP BY genre
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
    ORDER BY COUNT(*) DESC, g.genre ASC
    LIMIT ${limit}
  `.execute(db);
  return result.rows;
}

/** Most-populated genres, cached with stale-while-revalidate. */
export function getTopGenres(
  db: Database,
  kv: Storage,
  limit: number,
  language?: string,
): Promise<GenreCount[]> {
  return readThroughCache<GenreCount[]>(
    kv as Storage<GenreCount[]>,
    GENRES_KEY(language || "all", limit),
    () => queryTopGenres(db, limit, language),
    [],
    CACHE_OPTS,
  );
}
