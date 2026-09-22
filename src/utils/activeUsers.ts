/**
 * Reader count for the logged-out landing page's community statistics.
 *
 * An "active user" here means someone with at least one book on their profile —
 * a `user_book` row with a non-null `status` (the four shelf statuses are what
 * the profile renders; an owned-only row has no shelf). Counting this is cheap:
 * a distinct scan over `user_book`, and it is cached *inside* this helper with
 * stale-while-revalidate, same policy as `src/utils/authorStats.ts` /
 * `src/utils/exploreGenres.ts`, so the request path never recomputes it.
 */
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import { readThroughCache } from "./readThroughCache";

/** Same policy as the explore aggregates — SWR so no request blocks on a refresh. */
const CACHE_OPTS = { ttl: 86_400_000, revalidateAfter: 3_600_000 } as const;

const ACTIVE_USERS_KEY = "stats:active-users:v1";

/**
 * Distinct users who have at least one book on their profile (a shelfed
 * `user_book` row). Cached with a 24h TTL and 1h revalidation.
 */
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
