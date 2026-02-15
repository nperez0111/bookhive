import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { SessionClient } from "../auth/client";
import type { AppContext } from "../context";

export interface FollowsSync {
  userDid: string;
  lastFullSync: string | null;
  lastIncrementalSync: string | null;
  cursor: string | null;
}

export async function syncUserFollows(
  ctx: AppContext,
  agent: SessionClient,
): Promise<void> {
  const userDid = agent.did;

  try {
    const syncType = await determineSyncType(ctx, userDid);

    if (syncType === "full") {
      await fullFollowsSync(ctx, agent, userDid);
    } else {
      await incrementalFollowsSync(ctx, agent, userDid);
    }

    await updateSyncMetadata(ctx, userDid, syncType);
  } catch (error) {
    ctx.addWideEventContext({
      follows_sync: "failed",
      userDid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function determineSyncType(
  ctx: AppContext,
  userDid: string,
): Promise<"full" | "incremental"> {
  try {
    const syncData = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);

    ctx.addWideEventContext({
      follows_sync_check: true,
      userDid,
      has_previous_sync: !!syncData?.lastFullSync,
    });

    if (!syncData?.lastFullSync) {
      return "full";
    }

    const lastFullSync = new Date(syncData.lastFullSync);
    const daysSinceFullSync =
      (Date.now() - lastFullSync.getTime()) / (1000 * 60 * 60 * 24);

    ctx.addWideEventContext({
      follows_days_since_full_sync: daysSinceFullSync,
    });

    return daysSinceFullSync > 7 ? "full" : "incremental";
  } catch (error) {
    ctx.addWideEventContext({
      follows_sync_type_check: "error",
      userDid,
      error: error instanceof Error ? error.message : String(error),
    });
    return "full";
  }
}

async function fullFollowsSync(
  ctx: AppContext,
  agent: SessionClient,
  userDid: string,
): Promise<void> {
  ctx.addWideEventContext({
    follows_sync_type: "full",
    userDid,
  });

  // Mark all existing follows as potentially stale
  try {
    await ctx.db
      .updateTable("user_follows")
      .set({ isActive: 0 })
      .where("userDid", "=", userDid)
      .execute();
  } catch (error) {
    ctx.addWideEventContext({
      follows_mark_stale: "failed",
      userDid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  let cursor: string | undefined;
  let totalSynced = 0;

  do {
    let response;
    try {
      response = await agent.get("app.bsky.graph.getFollows", {
        params: {
          actor: userDid as ActorIdentifier,
          limit: 100,
          cursor,
        },
      });
    } catch (error) {
      ctx.addWideEventContext({
        follows_fetch_api: "failed",
        userDid,
        cursor,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (!response.ok) break;
    type GetFollowsOut = {
      follows: Array<{ did: string; createdAt?: string }>;
      cursor?: string;
    };
    const out = response.data as GetFollowsOut;
    const follows = out.follows;
    const now = new Date().toISOString();

    if (follows.length > 0) {
      // Upsert follows
      for (const follow of follows) {
        await ctx.db
          .insertInto("user_follows")
          .values({
            userDid,
            followsDid: follow.did,
            followedAt: follow.createdAt || now,
            syncedAt: now,
            lastSeenAt: now,
            isActive: 1,
          })
          .onConflict((oc) =>
            oc.columns(["userDid", "followsDid"]).doUpdateSet({
              lastSeenAt: now,
              isActive: 1,
            }),
          )
          .execute();
      }

      totalSynced += follows.length;
    }

    cursor = out.cursor;
  } while (cursor && totalSynced < 1000); // Limit to prevent runaway syncs

  // Remove follows that weren't seen (unfollowed)
  const removed = await ctx.db
    .deleteFrom("user_follows")
    .where("userDid", "=", userDid)
    .where("isActive", "=", 0)
    .executeTakeFirst();

  ctx.addWideEventContext({
    follows_full_sync_completed: true,
    userDid,
    total_synced: totalSynced,
    removed: Number(removed.numDeletedRows),
  });
}

async function incrementalFollowsSync(
  ctx: AppContext,
  agent: SessionClient,
  userDid: string,
): Promise<void> {
  ctx.addWideEventContext({
    follows_sync_type: "incremental",
    userDid,
  });

  let newFollows = 0;
  let cursor: string | undefined = undefined;
  let foundExisting = false;

  // Fetch follows starting from the most recent until we find ones we already have
  do {
    const response = await agent.get("app.bsky.graph.getFollows", {
      params: {
        actor: userDid as ActorIdentifier,
        limit: 100,
        cursor,
      },
    });
    if (!response.ok) break;
    type GetFollowsOut = {
      follows: Array<{ did: string; createdAt?: string }>;
      cursor?: string;
    };
    const out = response.data as GetFollowsOut;
    const follows = out.follows;
    const now = new Date().toISOString();

    if (follows.length === 0) break;

    // Check if we've seen any of these follows before
    for (const follow of follows) {
      const exists = await ctx.db
        .selectFrom("user_follows")
        .select("userDid")
        .where("userDid", "=", userDid)
        .where("followsDid", "=", follow.did)
        .executeTakeFirst();

      if (exists) {
        // We've caught up to existing data
        foundExisting = true;
        break;
      }

      // This is a new follow, store it
      await ctx.db
        .insertInto("user_follows")
        .values({
          userDid,
          followsDid: follow.did,
          followedAt: follow.createdAt || now,
          syncedAt: now,
          lastSeenAt: now,
          isActive: 1,
        })
        .onConflict((oc) =>
          oc.columns(["userDid", "followsDid"]).doUpdateSet({
            lastSeenAt: now,
            isActive: 1,
          }),
        )
        .execute();

      newFollows++;
    }

    cursor = out.cursor;
  } while (cursor && !foundExisting);

  ctx.addWideEventContext({
    follows_incremental_sync_completed: true,
    userDid,
    new_follows: newFollows,
  });
}

async function updateSyncMetadata(
  ctx: AppContext,
  userDid: string,
  syncType: "full" | "incremental",
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const existing = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);

    const syncData: FollowsSync = {
      userDid,
      lastFullSync: syncType === "full" ? now : existing?.lastFullSync || null,
      lastIncrementalSync: now,
      cursor: null, // Reset cursor after sync
    };

    ctx.addWideEventContext({
      follows_sync_metadata: "updating",
      userDid,
      sync_type: syncType,
    });

    await ctx.kv.set(`follows_sync:${userDid}`, syncData);

    const saved = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);
    ctx.addWideEventContext({
      follows_sync_metadata_saved: !!saved,
      userDid,
    });
  } catch (error) {
    ctx.addWideEventContext({
      follows_sync_metadata: "error",
      userDid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getUserFollows(
  ctx: AppContext,
  userDid: string,
  limit = 500,
): Promise<string[]> {
  const follows = await ctx.db
    .selectFrom("user_follows")
    .select("followsDid")
    .where("userDid", "=", userDid)
    .where("isActive", "=", 1)
    .orderBy("syncedAt", "desc")
    .limit(limit)
    .execute();

  return follows.map((f) => f.followsDid);
}

export async function shouldSyncFollows(
  ctx: AppContext,
  userDid: string,
): Promise<boolean> {
  try {
    const syncData = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);

    if (!syncData?.lastIncrementalSync) {
      return true;
    }

    const lastSync = new Date(syncData.lastIncrementalSync);
    const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);

    return hoursSinceSync > 6;
  } catch (error) {
    ctx.addWideEventContext({
      follows_should_sync_check: "error",
      userDid,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

export async function ensureFollowsAreFresh(
  ctx: AppContext,
  agent: SessionClient | null,
): Promise<void> {
  if (!agent?.did) return;

  try {
    const shouldSync = await shouldSyncFollows(ctx, agent.did);
    if (shouldSync) {
      // Trigger async sync (don't block the request)
      syncUserFollows(ctx, agent).catch((error) => {
        ctx.addWideEventContext({
          follows_refresh: "failed",
          userDid: agent.did,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  } catch (error) {
    ctx.addWideEventContext({
      follows_freshness_check: "error",
      userDid: agent.did,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
