import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { Database } from "../db";
import type { HiveId } from "../types";
import { readThroughCache } from "../lib/readThroughCache";

/**
 * The reads behind a profile: `/profile/:handle`, `/profile/:handle/stats/:year`,
 * XRPC `getProfile`, and the OG profile card.
 *
 * Three surfaces used to derive these independently and disagreed about
 * nearly everything — book limits, ordering, genre cuts, and whether follow
 * counts were cached at all.
 *
 * `isBuzzer` is its own function because it's a cheap guard question that
 * `/profile/:handle` asks twice and that gates every expensive query below.
 */

/**
 * DIDs with at least one book here.
 *
 * One definition, because `getFollowCounts` produces the number and
 * `getFollowDids` produces the list rendered under it — narrowing one and not
 * the other reads "12 following" above 15 avatars.
 */
export function buildFollowMembershipQuery({
  db,
  did,
  direction,
}: {
  db: Database;
  did: string;
  direction: "following" | "followers";
}) {
  const owner = direction === "following" ? "userDid" : "followsDid";
  const member = direction === "following" ? "user_follows.followsDid" : "user_follows.userDid";
  return (
    db
      .selectFrom("user_follows")
      .where(owner, "=", did)
      .where("isActive", "=", 1)
      // Probe the member's userDid index instead of building a DISTINCT set of
      // every BookHive reader. Owned-only rows still establish membership.
      .where((eb) =>
        eb.exists(
          eb.selectFrom("user_book").select("userDid").whereRef("user_book.userDid", "=", member),
        ),
      )
  );
}

/** Does this DID have any book on BookHive at all? Gates the expensive reads. */
export async function isBuzzer({ db, did }: { db: Database; did: string }): Promise<boolean> {
  const row = await db
    .selectFrom("user_book")
    .select("userDid")
    .where("userDid", "=", did)
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}

/** Is the viewer following this DID? `undefined` when there is no viewer. */
export async function isFollowing({
  db,
  viewerDid,
  targetDid,
}: {
  db: Database;
  viewerDid: string | null | undefined;
  targetDid: string;
}): Promise<boolean | undefined> {
  if (!viewerDid || viewerDid === targetDid) return undefined;
  const row = await db
    .selectFrom("user_follows")
    .select(["followsDid"])
    .where("userDid", "=", viewerDid)
    .where("followsDid", "=", targetDid)
    .where("isActive", "=", 1)
    .executeTakeFirst();
  return Boolean(row);
}

/**
 * Follow counts, restricted to DIDs that actually have a book here — an
 * unrestricted count would include strangers who have never used BookHive.
 * Cached because the number moves slowly.
 */
export async function getFollowCounts({
  db,
  kv,
  did,
}: {
  db: Database;
  kv: Storage;
  did: string;
}): Promise<{ followingCount: number; followersCount: number }> {
  return await readThroughCache<{ followingCount: number; followersCount: number }>(
    kv as Storage<{ followingCount: number; followersCount: number }>,
    `followCounts:${did}`,
    async () => {
      const [following, followers] = await Promise.all([
        buildFollowMembershipQuery({ db, did, direction: "following" })
          .select((eb) => eb.fn.countAll().as("count"))
          .executeTakeFirst(),
        buildFollowMembershipQuery({ db, did, direction: "followers" })
          .select((eb) => eb.fn.countAll().as("count"))
          .executeTakeFirst(),
      ]);
      return {
        followingCount: Number(following?.count ?? 0),
        followersCount: Number(followers?.count ?? 0),
      };
    },
    { followingCount: 0, followersCount: 0 },
    // SWR, not a plain TTL — a per-DID key on a plain TTL made a popular profile pay a blocking recompute repeatedly, each one stalling a whole synchronous bun:sqlite worker.
    { ttl: 3_600_000, revalidateAfter: 300_000 },
  );
}

/** The most recent follows in each direction, again restricted to buzzers. */
export async function getFollowDids({
  db,
  did,
  limit = 50,
}: {
  db: Database;
  did: string;
  limit?: number;
}): Promise<{ following: string[]; followers: string[] }> {
  const [followingRows, followersRows] = await Promise.all([
    buildFollowMembershipQuery({ db, did, direction: "following" })
      .select("followsDid")
      .orderBy("followedAt", "desc")
      .orderBy("followsDid", "desc")
      .limit(limit)
      .execute(),
    buildFollowMembershipQuery({ db, did, direction: "followers" })
      .select("userDid")
      .orderBy("followedAt", "desc")
      .orderBy("userDid", "desc")
      .limit(limit)
      .execute(),
  ]);
  return {
    following: followingRows.map((r) => r.followsDid),
    followers: followersRows.map((r) => r.userDid),
  };
}

/**
 * Genre counts across a set of books.
 *
 * `genre ASC` is the tiebreaker: counts tie constantly in the long tail and the
 * profile slices the top 10, so without it the chart reshuffled between two
 * loads of the same page.
 */
export async function getGenreCounts({
  db,
  hiveIds,
  limit = 10,
}: {
  db: Database;
  hiveIds: HiveId[];
  limit?: number;
}): Promise<{ genre: string; count: number }[]> {
  if (hiveIds.length === 0) return [];
  const rows = await db
    .selectFrom("hive_book_genre")
    .select(["genre", sql<number>`COUNT(*)`.as("count")])
    .where("hiveId", "in", hiveIds)
    .groupBy("genre")
    .orderBy(sql`COUNT(*)`, "desc")
    .orderBy("genre", "asc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({ genre: r.genre, count: Number(r.count) }));
}

/** A user's recent progress entries, joined to the book they belong to. */
export async function listRecentProgress({
  db,
  did,
  limit = 30,
}: {
  db: Database;
  did: string;
  limit?: number;
}) {
  return await db
    .selectFrom("progress_history")
    .innerJoin("hive_book", "progress_history.hiveId", "hive_book.id")
    .select([
      "progress_history.hiveId",
      "hive_book.title",
      "hive_book.cover",
      "hive_book.thumbnail",
      "progress_history.currentPage",
      "progress_history.totalPages",
      "progress_history.percent",
      "progress_history.createdAt",
    ])
    .where("progress_history.userDid", "=", did)
    .orderBy("progress_history.createdAt", "desc")
    .orderBy("progress_history.id", "desc")
    .limit(limit)
    .execute();
}
