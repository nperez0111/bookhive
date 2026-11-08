import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { SessionClient } from "../auth/client";
import type { AppContext } from "../context";
import { followSyncDuration, LABEL } from "../metrics";
import { errorMessage } from "../lib/errors";

export interface FollowsSync {
  userDid: string;
  lastFullSync: string | null;
  lastIncrementalSync: string | null;
  cursor: string | null;
}

export async function syncUserFollows(ctx: AppContext, agent: SessionClient): Promise<void> {
  const userDid = agent.did;

  try {
    const syncType = await determineSyncType(ctx, userDid);
    const end = followSyncDuration.startTimer(LABEL.followSync[syncType]);

    try {
      await fetchAndCommitFollows(ctx, agent, userDid, syncType);
    } finally {
      end();
    }

    await updateSyncMetadata(ctx, userDid, syncType);
  } catch (error) {
    ctx.addWideEventContext({
      follows_sync: "failed",
      userDid,
      error: errorMessage(error),
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
    const daysSinceFullSync = (Date.now() - lastFullSync.getTime()) / (1000 * 60 * 60 * 24);

    ctx.addWideEventContext({
      follows_days_since_full_sync: daysSinceFullSync,
    });

    return daysSinceFullSync > 7 ? "full" : "incremental";
  } catch (error) {
    ctx.addWideEventContext({
      follows_sync_type_check: "error",
      userDid,
      error: errorMessage(error),
    });
    return "full";
  }
}

async function fetchAndCommitFollows(
  ctx: AppContext,
  agent: SessionClient,
  userDid: string,
  syncType: "full" | "incremental",
): Promise<void> {
  ctx.addWideEventContext({
    follows_sync_type: syncType,
    userDid,
  });

  type Follow = { did: string; createdAt?: string };
  const staged = new Map<string, Follow>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let totalSynced = 0;
  let complete = false;

  // Bound requests: duplicate pages must not run forever, even with fresh cursors.
  for (let page = 0; page < 500; page++) {
    const response = await agent.get("app.bsky.graph.getFollows", {
      params: {
        actor: userDid as ActorIdentifier,
        limit: 100,
        cursor,
      },
      headers: { "atproto-proxy": "did:web:api.bsky.app#bsky_appview" },
    });
    if (!response.ok) throw new Error("Failed to fetch follows");
    const out = response.data as { follows: Follow[]; cursor?: string };
    const follows = out.follows;
    if (out.cursor && (cursors.has(out.cursor) || follows.length === 0)) {
      throw new Error("Incomplete follows scan: invalid cursor traversal");
    }
    totalSynced += follows.length;

    let existingDids = new Set<string>();
    if (syncType === "incremental" && follows.length > 0) {
      // Inactive rows are NOT a caught-up boundary: they need reactivation.
      const existing = await ctx.db
        .selectFrom("user_follows")
        .select("followsDid")
        .where("userDid", "=", userDid)
        .where("isActive", "=", 1)
        .where(
          "followsDid",
          "in",
          follows.map((follow) => follow.did),
        )
        .execute();
      existingDids = new Set(existing.map((follow) => follow.followsDid));
    }
    let foundExisting = false;
    for (const follow of follows) {
      if (existingDids.has(follow.did)) {
        foundExisting = true;
        break;
      }
      staged.set(follow.did, follow);
    }
    if (!out.cursor || foundExisting) {
      complete = true;
      break;
    }
    cursors.add(out.cursor);
    cursor = out.cursor;
  }
  if (!complete) throw new Error("Incomplete follows scan: scan limit");

  // No remote I/O under the write transaction; failures above leave the mirror
  // untouched. The mark/upsert/prune sequence is atomic to other workers too.
  const now = new Date().toISOString();
  const removed = await ctx.db.transaction().execute(async (tx) => {
    if (syncType === "full") {
      await tx
        .updateTable("user_follows")
        .set({ isActive: 0 })
        .where("userDid", "=", userDid)
        .execute();
    }
    const rows = [...staged.values()].map((follow) => ({
      userDid,
      followsDid: follow.did,
      followedAt: follow.createdAt || now,
      syncedAt: now,
      lastSeenAt: now,
      isActive: 1 as const,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      await tx
        .insertInto("user_follows")
        .values(rows.slice(i, i + 100))
        .onConflict((oc) =>
          oc.columns(["userDid", "followsDid"]).doUpdateSet({
            lastSeenAt: now,
            isActive: 1,
          }),
        )
        .execute();
    }
    if (syncType !== "full") return 0;
    const result = await tx
      .deleteFrom("user_follows")
      .where("userDid", "=", userDid)
      .where("isActive", "=", 0)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  });
  ctx.addWideEventContext({
    [syncType === "full" ? "follows_full_sync_completed" : "follows_incremental_sync_completed"]:
      true,
    userDid,
    total_synced: totalSynced,
    removed,
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
      error: errorMessage(error),
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

export async function shouldSyncFollows(ctx: AppContext, userDid: string): Promise<boolean> {
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
      error: errorMessage(error),
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
          error: errorMessage(error),
        });
      });
    }
  } catch (error) {
    ctx.addWideEventContext({
      follows_freshness_check: "error",
      userDid: agent.did,
      error: errorMessage(error),
    });
  }
}
