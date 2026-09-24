import { sql } from "kysely";
import type { Storage } from "unstorage";
import { FINISHED } from "../constants";
import type { Database } from "../db";
import { readThroughCache } from "../lib/readThroughCache";
import { getActiveUserCount } from "./activeUsers";

export type CommunityStats = {
  readers: number;
  booksTracked: number;
  booksFinishedLastWeek: number;
};

/** A weekly global snapshot, refreshed at most daily independently of landing activity. */
export function getCommunityStats(db: Database, kv: Storage): Promise<CommunityStats | null> {
  return readThroughCache<CommunityStats | null>(
    kv,
    "stats:community:v2",
    async () => {
      const readers = await getActiveUserCount(db, kv);
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
      // Count shelf entries, not catalogue titles; owned-only records have no status.
      const result = await sql<Omit<CommunityStats, "readers">>`
        SELECT COUNT(*) AS booksTracked,
          COUNT(CASE WHEN status = ${FINISHED}
            AND julianday(finishedAt) >= julianday(${weekAgo.toISOString()})
            AND julianday(finishedAt) <= julianday(${now.toISOString()})
            THEN 1 END) AS booksFinishedLastWeek
        FROM user_book
        WHERE status IS NOT NULL
      `.execute(db);
      const row = result.rows[0]!;
      return {
        readers,
        booksTracked: Number(row.booksTracked),
        booksFinishedLastWeek: Number(row.booksFinishedLastWeek),
      };
    },
    null,
    { ttl: 7 * 86_400_000, revalidateAfter: 86_400_000 },
  );
}
