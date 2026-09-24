import { sql } from "kysely";
import type { Storage } from "unstorage";
import { readThroughCache } from "../lib/readThroughCache";
import type { Database } from "../db";

/**
 * Stale-while-revalidate, matching `authorStats` / `exploreGenres` /
 * `landingHighlights` — a plain TTL would make the expiry a blocking recompute
 * on the request path of five routes, stalling a whole synchronous
 * `bun:sqlite` worker.
 */
const LANGUAGES_CACHE_TTL = 86_400_000; // 1 day
const LANGUAGES_REVALIDATE_AFTER = 3_600_000; // 1 hour

/**
 * Returns an alphabetically-sorted list of languages with at least 5 books.
 *
 * The key carries a version suffix so a predicate change orphans the old
 * entry rather than serving it for another day — nothing sweeps non-`page:`
 * KV keys.
 */
export async function getAvailableLanguages(db: Database, kv: Storage): Promise<string[]> {
  return readThroughCache<string[]>(
    kv as Storage<string[]>,
    "languages:all:v2",
    async () => {
      const rows = await db
        .selectFrom("hive_book")
        .select(["language"])
        .where("language", "is not", null)
        .where("language", "!=", "")
        .groupBy("language")
        .having(sql`COUNT(*)`, ">=", 5)
        .orderBy("language", "asc")
        .execute();
      return rows.map((r) => r.language!);
    },
    [],
    { ttl: LANGUAGES_CACHE_TTL, revalidateAfter: LANGUAGES_REVALIDATE_AFTER },
  );
}

/**
 * Narrow a client-supplied `?lang=` / `language=` to one we actually have
 * books in, or `undefined`.
 *
 * An unvalidated free-form string would be both an unbounded KV-key
 * cardinality amplifier and an unbounded CPU one — `?lang=<junk>` would key
 * its own cache entry and run its own expensive GROUP BY to produce an empty
 * list.
 */
export async function resolveLanguage(
  db: Database,
  kv: Storage,
  lang: string | undefined | null,
): Promise<string | undefined> {
  if (!lang) return undefined;
  const languages = await getAvailableLanguages(db, kv);
  return languages.includes(lang) ? lang : undefined;
}
