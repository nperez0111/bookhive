import { BookFields, type Database } from "../db";
import { readThroughCache } from "../lib/readThroughCache";
import type { Storage } from "unstorage";

/**
 * What the signed-out landing page (`/`) shows: what people are reading this
 * week, and the most recent activity.
 *
 * Stale-while-revalidate, not a plain TTL — a plain TTL makes every expiry a
 * blocking recompute, and `bun:sqlite` is synchronous, so that request stalls
 * its whole worker on the highest-traffic route in the app.
 *
 * `/` is not in the anon page cache's prefixes, so this KV entry is the only
 * thing in front of it at the origin.
 */

/** How far back "trending" looks before falling back to all-time. */
const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TRENDING_LIMIT = 10;

/** Matches `authorStats` / `exploreGenres`: a day of life, refreshed after an hour. */
const CACHE_OPTS = { ttl: 86_400_000, revalidateAfter: 3_600_000 } as const;

export type TrendingBook = {
  id: string;
  title: string;
  authors: string;
  thumbnail: string;
  readerCount: number;
};

function trendingQuery(db: Database, since: string | null) {
  return (
    db
      .selectFrom("hive_book as hb")
      .innerJoin("user_book as ub", "hb.id", "ub.hiveId")
      .select([
        "hb.id",
        "hb.title",
        "hb.authors",
        "hb.thumbnail",
        (eb) => eb.fn.count<number>("ub.userDid").distinct().as("readerCount"),
      ])
      .$if(since !== null, (qb) => qb.where("ub.createdAt", ">", since!))
      .groupBy("hb.id")
      .orderBy("readerCount", "desc")
      .orderBy("hb.ratingsCount", "desc")
      // Unique final key: readerCount and ratingsCount both tie heavily, so without this the trending row reshuffled between cache fills.
      .orderBy("hb.id", "asc")
      .limit(TRENDING_LIMIT)
  );
}

export type LandingHighlights = {
  trendingBooks: TrendingBook[];
  recentRows: Awaited<ReturnType<typeof recentActivity>>;
};

function recentActivity(db: Database, limit: number) {
  return db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .orderBy("user_book.createdAt", "desc")
    .orderBy("user_book.uri", "desc")
    .limit(limit)
    .execute();
}

/**
 * The landing page's two lists. Cached inside the helper, the same way
 * `getAuthorStats` and `getTopGenres` are — so a second consumer cannot wrap
 * it in a different policy, which is how `/explore` ended up with three.
 */
export async function getLandingHighlights({
  db,
  kv,
  recentLimit = 10,
}: {
  db: Database;
  kv: Storage;
  recentLimit?: number;
}): Promise<LandingHighlights> {
  return await readThroughCache<LandingHighlights>(
    kv as Storage<LandingHighlights>,
    "marketing:landing:v2",
    async () => {
      const since = new Date(Date.now() - TRENDING_WINDOW_MS).toISOString();
      const [recentWindow, recentRows] = await Promise.all([
        trendingQuery(db, since).execute(),
        recentActivity(db, recentLimit),
      ]);
      // A quiet week should still fill the shelf, so fall back to all-time — but only then, and only once.
      const trendingBooks =
        recentWindow.length >= TRENDING_LIMIT
          ? recentWindow
          : await trendingQuery(db, null).execute();
      return { trendingBooks, recentRows };
    },
    { trendingBooks: [], recentRows: [] },
    CACHE_OPTS,
  );
}
