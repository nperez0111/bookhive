import { sql } from "kysely";
import type { Storage } from "unstorage";
import { readThroughCache } from "./readThroughCache";
import type { Database } from "../db";

const LANGUAGES_CACHE_TTL = 86_400_000; // 1 day

/**
 * Returns an alphabetically-sorted list of languages that have at least 5 books.
 * Results are cached in KV with a 1-day TTL.
 */
export async function getAvailableLanguages(db: Database, kv: Storage): Promise<string[]> {
  return readThroughCache<string[]>(
    kv as Storage<string[]>,
    "languages:all",
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
    { ttl: LANGUAGES_CACHE_TTL },
  );
}

/**
 * Narrow a client-supplied `?lang=` / `language=` to one we actually have books
 * in, or `undefined`.
 *
 * The explore aggregates are cached per language and are expensive to compute,
 * so an unvalidated free-form string is both an unbounded KV-key cardinality
 * amplifier and an unbounded CPU one — `?lang=<junk>` would key its own cache
 * entry and run its own 356k-row GROUP BY to produce an empty list. The
 * language list this checks against is itself cached for a day.
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
