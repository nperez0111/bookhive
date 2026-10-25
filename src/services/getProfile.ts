import { Client } from "@atcute/client";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import lruCacheDriver from "unstorage/drivers/lru-cache";
import { setIdentityCache } from "../bsky/id-resolver";
import type { ProfileViewDetailed } from "../types";
import type { AppContext } from "../context";
import { Semaphore, withTimeout } from "../lib/semaphore";

const REVALIDATE_AFTER = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 2_500;
const BATCH_SIZE = 25;

export function createProfileCache() {
  return lruCacheDriver({ max: 10_000, ttl: 30 * REVALIDATE_AFTER });
}

type CachedProfile = { profile: ProfileViewDetailed; fetchedAt: number };

// Shared across viewers and requests, not one limiter per batch/page. Hold slots
// until the actual request settles, even if the caller's deadline wins first.
const requests = new Semaphore(3, {
  label: "profile fetch",
  maxPending: 12,
  acquireTimeoutMs: 500,
});
const inFlight = new WeakMap<AppContext["kv"], Map<string, Promise<ProfileViewDetailed | null>>>();
const publicClient = new Client({
  handler: (path, init) => fetch(new URL(path, "https://public.api.bsky.app"), init),
});

function profileCacheKey(targetDid: string, viewerDid: string | null): string {
  return viewerDid ? "profile:" + viewerDid + ":" + targetDid : "profile:pub:" + targetDid;
}

type ProfileContext = Pick<AppContext, "kv" | "getSessionAgent"> &
  Partial<Pick<AppContext, "getSessionDid">>;

export async function getProfile({
  ctx,
  did,
  publicOnly,
}: {
  ctx: ProfileContext;
  did: string;
  publicOnly?: boolean;
}): Promise<ProfileViewDetailed | null> {
  return (await getProfiles({ ctx, dids: [did], publicOnly }))[0] ?? null;
}

export async function getProfiles({
  ctx,
  dids,
  publicOnly,
}: {
  ctx: ProfileContext;
  dids: string[];
  publicOnly?: boolean;
}): Promise<ProfileViewDetailed[]> {
  dids = Array.from(new Set(dids));
  if (dids.length === 0) return [];
  // Request contexts can identify the viewer from the cookie without restoring OAuth.
  const viewerDid = publicOnly
    ? null
    : ctx.getSessionDid
      ? await ctx.getSessionDid()
      : ((await ctx.getSessionAgent())?.did ?? null);
  let pending = inFlight.get(ctx.kv);
  if (!pending) {
    pending = new Map();
    inFlight.set(ctx.kv, pending);
  }
  const entries = await Promise.all(
    dids.map(async (did) => {
      const key = profileCacheKey(did, viewerDid);
      const cached = await ctx.kv.get<CachedProfile>(key);
      return {
        did,
        key,
        value: cached?.profile ?? null,
        refresh: !cached || Date.now() - cached.fetchedAt >= REVALIDATE_AFTER,
      };
    }),
  );

  const refresh = entries.filter((entry) => entry.refresh && !pending.has(entry.key));
  for (let i = 0; i < refresh.length; i += BATCH_SIZE) {
    const batch = refresh.slice(i, i + BATCH_SIZE);
    const work = (async () => {
      try {
        const sessionClient = publicOnly ? null : await ctx.getSessionAgent();
        // A stale cookie/failed restore must never populate the viewer's cache
        // with a public response (or another viewer's relationship state).
        if ((sessionClient?.did ?? null) !== viewerDid) {
          const profiles = await getProfiles({
            ctx,
            dids: batch.map((entry) => entry.did),
            publicOnly: true,
          });
          return new Map(profiles.map((profile) => [profile.did, profile]));
        }
        const client = sessionClient ?? publicClient;
        const response = await withTimeout(
          requests.run(() =>
            client.get("app.bsky.actor.getProfiles", {
              params: { actors: batch.map((entry) => entry.did) as ActorIdentifier[] },
              ...(sessionClient
                ? { headers: { "atproto-proxy": "did:web:api.bsky.app#bsky_appview" } }
                : {}),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT),
            }),
          ),
          REQUEST_TIMEOUT + 500,
          "profile fetch",
        );
        if (!response.ok) throw new Error("Profile request failed");
        const profiles = new Map<string, ProfileViewDetailed>(
          (response.data as { profiles: ProfileViewDetailed[] }).profiles.map((profile) => [
            profile.did,
            profile,
          ]),
        );
        await Promise.all(
          batch.map(async (entry) => {
            const profile = profiles.get(entry.did) ?? null;
            if (!profile) {
              await ctx.kv.remove(entry.key);
              return;
            }
            // Value and freshness share one LRU entry, not independently evictable metadata.
            await ctx.kv.set(entry.key, { profile, fetchedAt: Date.now() });
            if (profile?.did && profile.handle) {
              await setIdentityCache(ctx.kv, profile.did, profile.handle).catch(() => {});
            }
          }),
        );
        return profiles;
      } catch {
        return new Map<string, ProfileViewDetailed>();
      }
    })();
    for (const entry of batch) {
      const result = work
        .then((profiles) => profiles.get(entry.did) ?? null)
        .finally(() => pending.delete(entry.key));
      pending.set(entry.key, result);
    }
  }

  // Stale readers never join the refresh promise, including one started by a
  // simultaneous cold/single-profile reader. Only genuine misses wait.
  const values = await Promise.all(
    entries.map(async (entry) => entry.value ?? pending.get(entry.key) ?? null),
  );
  return values.filter((value): value is ProfileViewDetailed => value !== null);
}
