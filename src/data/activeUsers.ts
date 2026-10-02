/**
 * Distinct users with at least one shelf-visible book, cached with SWR.
 */
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import { readThroughCache } from "../lib/readThroughCache";

const CACHE_OPTS = { ttl: 86_400_000, revalidateAfter: 3_600_000 } as const;
const ACTIVE_USERS_KEY = "stats:active-users:v1";

export function getActiveUserCount(db: Database, kv: Storage): Promise<number> {
  return readThroughCache<number>(
    kv as Storage<number>,
    ACTIVE_USERS_KEY,
    async () => {
      const result = await sql<{ activeUsers: number }>`
        SELECT COUNT(DISTINCT userDid) as activeUsers
        FROM user_book
        WHERE status IS NOT NULL
      `.execute(db);
      return Number(result.rows[0]?.activeUsers) || 0;
    },
    0,
    CACHE_OPTS,
  );
}
