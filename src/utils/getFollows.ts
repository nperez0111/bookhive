import { Agent } from "@atproto/api";
import type { AppContext } from "..";
import { getLogger } from "../logger";

export interface FollowsSync {
  userDid: string;
  lastFullSync: string | null;
  lastIncrementalSync: string | null;
  cursor: string | null;
}

const logger = getLogger({ name: "follows-sync" });



export async function syncUserFollows(ctx: AppContext, agent: Agent): Promise<void> {
  const userDid = agent.assertDid;
  
  try {
    const syncType = await determineSyncType(ctx, userDid);
    
    if (syncType === 'full') {
      await fullFollowsSync(ctx, agent, userDid);
    } else {
      await incrementalFollowsSync(ctx, agent, userDid);
    }
    
    await updateSyncMetadata(ctx, userDid, syncType);
  } catch (error) {
    logger.error({ 
      userDid, 
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error 
    }, "Failed to sync follows");
    throw error;
  }
}

async function determineSyncType(ctx: AppContext, userDid: string): Promise<'full' | 'incremental'> {
  try {
    const syncData = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);
    
    logger.info({ userDid, syncData }, "Checking sync type");
    
    if (!syncData?.lastFullSync) {
      logger.info({ userDid }, "No previous full sync found, doing full sync");
      return 'full';
    }
    
    const lastFullSync = new Date(syncData.lastFullSync);
    const daysSinceFullSync = (Date.now() - lastFullSync.getTime()) / (1000 * 60 * 60 * 24);
    
    logger.info({ userDid, daysSinceFullSync }, "Days since last full sync");
    
    return daysSinceFullSync > 7 ? 'full' : 'incremental';
  } catch (error) {
    logger.warn({ userDid, error }, "Error checking sync type, defaulting to full sync");
    return 'full';
  }
}

async function fullFollowsSync(ctx: AppContext, agent: Agent, userDid: string): Promise<void> {
  logger.info({ userDid }, "Starting full follows sync");
  

  
  // Mark all existing follows as potentially stale
  try {
    await ctx.db
      .updateTable("user_follows")
      .set({ isActive: 0 })
      .where("userDid", "=", userDid)
      .execute();
  } catch (error) {
    logger.error({ userDid, error }, "Failed to mark follows as stale - table may not exist");
    throw error;
  }
  
  let cursor: string | undefined;
  let totalSynced = 0;
  
  do {
    let response;
    try {
      response = await agent.app.bsky.graph.getFollows({
        actor: userDid,
        limit: 100,
        cursor,
      });
    } catch (error) {
      logger.error({ 
        userDid, 
        cursor,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error 
      }, "Failed to fetch follows from Bluesky API");
      throw error;
    }
    
    const follows = response.data.follows;
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
            })
          )
          .execute();
      }
      
      totalSynced += follows.length;
    }
    
    cursor = response.data.cursor;
  } while (cursor && totalSynced < 1000); // Limit to prevent runaway syncs
  
  // Remove follows that weren't seen (unfollowed)
  const removed = await ctx.db
    .deleteFrom("user_follows")
    .where("userDid", "=", userDid)
    .where("isActive", "=", 0)
    .executeTakeFirst();
  
  logger.info({ userDid, totalSynced, removed: removed.numDeletedRows }, "Full follows sync completed");
}

async function incrementalFollowsSync(ctx: AppContext, agent: Agent, userDid: string): Promise<void> {
  logger.trace({ userDid }, "Starting incremental follows sync");
  
  const syncData = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);
  let cursor = syncData?.cursor;
  let newFollows = 0;
  
  // Fetch recent follows to catch new ones
  const response = await agent.app.bsky.graph.getFollows({
    actor: userDid,
    limit: 100,
    cursor: undefined, // Always start from the beginning for incremental
  });
  
  const follows = response.data.follows;
  const now = new Date().toISOString();
  
  if (follows.length > 0) {
    // Check if we've seen the first follow before
    const firstFollow = follows[0];
    const exists = await ctx.db
      .selectFrom("user_follows")
      .select("userDid")
      .where("userDid", "=", userDid)
      .where("followsDid", "=", firstFollow.did)
      .executeTakeFirst();
    
    if (exists && !cursor) {
      // We've caught up to existing data
      logger.trace({ userDid }, "No new follows found");
      return;
    }
    
    // Store new follows
    for (const follow of follows) {
      try {
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
            })
          )
          .execute();
        
        newFollows++;
      } catch (error) {
        // Follow already exists, continue
      }
    }
  }
  
  logger.info({ userDid, newFollows }, "Incremental follows sync completed");
}

async function updateSyncMetadata(ctx: AppContext, userDid: string, syncType: 'full' | 'incremental'): Promise<void> {
  try {
    const now = new Date().toISOString();
    const existing = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);
    
    const syncData: FollowsSync = {
      userDid,
      lastFullSync: syncType === 'full' ? now : existing?.lastFullSync || null,
      lastIncrementalSync: now,
      cursor: null, // Reset cursor after sync
    };
    
    logger.info({ userDid, syncType, syncData }, "Updating sync metadata");
    
    await ctx.kv.set(`follows_sync:${userDid}`, syncData);
    
    // Verify it was saved
    const saved = await ctx.kv.get<FollowsSync>(`follows_sync:${userDid}`);
    logger.info({ userDid, saved }, "Verified saved sync metadata");
  } catch (error) {
    logger.error({ userDid, error }, "Error updating sync metadata");
    throw error;
  }
}

export async function getUserFollows(ctx: AppContext, userDid: string, limit = 500): Promise<string[]> {
  const follows = await ctx.db
    .selectFrom("user_follows")
    .select("followsDid")
    .where("userDid", "=", userDid)
    .where("isActive", "=", 1)
    .orderBy("syncedAt", "desc")
    .limit(limit)
    .execute();
  
  return follows.map(f => f.followsDid);
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
    logger.warn({ userDid, error }, "Error checking sync status, defaulting to sync needed");
    return true;
  }
}

export async function ensureFollowsAreFresh(ctx: AppContext, agent: Agent): Promise<void> {
  if (!agent?.did) return;
  
  try {
    const shouldSync = await shouldSyncFollows(ctx, agent.assertDid);
    if (shouldSync) {
      // Trigger async sync (don't block the request)
      syncUserFollows(ctx, agent).catch((error) => {
        ctx.logger.warn({ userDid: agent.assertDid, error }, "Failed to refresh follows");
      });
    }
  } catch (error) {
    // Ignore errors - follows freshness is not critical for request success
    ctx.logger.trace({ userDid: agent.assertDid, error }, "Error checking follows freshness");
  }
}