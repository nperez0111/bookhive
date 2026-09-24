/**
 * The one follow / unfollow. All four routes (`/api/follow`, `/follow-form`,
 * `/unfollow`, `/unfollow-form`) are thin adapters over these.
 *
 * Rule: write to the user's PDS first, and only mirror into `user_follows` if
 * that write actually succeeded — the mirror must never get ahead of the PDS.
 *
 * Errors are a discriminated result, never a throw — each adapter owns whether
 * that becomes a 400 or a redirect.
 */
import * as TID from "@atcute/tid";

import type { SessionClient } from "../auth/client";
import type { Database } from "../db";

const FOLLOW_COLLECTION = "app.bsky.graph.follow";

// `listRecords` caps at 100 per page — paginate rather than take only the
// first page, bounded so a pathological repo can't hold a request open indefinitely.
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 50;

export type FollowResult = { ok: true; alreadyGone?: boolean } | { ok: false; message: string };

type ApplyWritesOut = { results?: Array<{ $type: string }> };

/** Mirror the follow into `user_follows`. Only ever called after a good PDS write. */
async function markFollowed(
  db: Database,
  userDid: string,
  followsDid: string,
  followedAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto("user_follows")
    .values({
      userDid,
      followsDid,
      followedAt,
      syncedAt: now,
      lastSeenAt: now,
      isActive: 1,
    })
    .onConflict((oc) =>
      oc.columns(["userDid", "followsDid"]).doUpdateSet({ lastSeenAt: now, isActive: 1 }),
    )
    .execute();
}

async function markUnfollowed(db: Database, userDid: string, followsDid: string): Promise<void> {
  await db
    .updateTable("user_follows")
    .set({ isActive: 0 })
    .where("userDid", "=", userDid)
    .where("followsDid", "=", followsDid)
    .execute();
}

export async function followUser({
  db,
  agent,
  targetDid,
}: {
  db: Database;
  agent: SessionClient;
  targetDid: string;
}): Promise<FollowResult> {
  const createdAt = new Date().toISOString();
  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#create",
          collection: FOLLOW_COLLECTION,
          rkey: TID.now(),
          value: { subject: targetDid, createdAt },
        },
      ],
    },
  });

  const out = response.data as ApplyWritesOut | null;
  const first = response.ok && out?.results?.[0] ? out.results[0] : undefined;
  if (!response.ok || first?.$type !== "com.atproto.repo.applyWrites#createResult") {
    return { ok: false, message: "Failed to follow user" };
  }

  await markFollowed(db, agent.did, targetDid, createdAt);
  return { ok: true };
}

export async function unfollowUser({
  db,
  agent,
  targetDid,
}: {
  db: Database;
  agent: SessionClient;
  targetDid: string;
}): Promise<FollowResult> {
  let cursor: string | undefined;
  let followUri: string | null = null;

  for (let page = 0; page < MAX_LIST_PAGES && !followUri; page++) {
    const listRes = await agent.get("com.atproto.repo.listRecords", {
      params: {
        repo: agent.did,
        collection: FOLLOW_COLLECTION,
        limit: LIST_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      },
    });
    // Not "assume it worked" — we can't tell "no such follow" from "couldn't ask".
    if (!listRes.ok) return { ok: false, message: "Failed to list follows" };

    const data = listRes.data as {
      records: Array<{ uri: string; value?: { subject?: string } }>;
      cursor?: string;
    };
    followUri = data.records.find((r) => r.value?.subject === targetDid)?.uri ?? null;
    cursor = data.cursor;
    if (!cursor || data.records.length === 0) break;
  }

  // The record is genuinely absent from the repo, so the local row is the only
  // thing left claiming the follow exists.
  if (!followUri) {
    await markUnfollowed(db, agent.did, targetDid);
    return { ok: true, alreadyGone: true };
  }

  const applyResult = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: FOLLOW_COLLECTION,
          rkey: followUri.split("/").at(-1)!,
        },
      ],
    },
  });
  if (!applyResult.ok) {
    return { ok: false, message: "Failed to delete follow record on remote" };
  }

  await markUnfollowed(db, agent.did, targetDid);
  return { ok: true };
}
