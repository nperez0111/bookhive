import { Client } from "@atcute/client";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import { setIdentityCache } from "../bsky/id-resolver";
import type { ProfileViewDetailed } from "../types";
import { readThroughCache } from "./readThroughCache";
import type { AppContext } from "../context";

/** Public fetch handler for unauthenticated XRPC (e.g. appview). 10s timeout. */
const publicHandler = {
  handle: (path: string, init?: RequestInit) =>
    fetch(new URL(path, "https://public.api.bsky.app").toString(), {
      ...init,
      signal: AbortSignal.timeout(10_000),
    }),
};

const REVALIDATE_AFTER = 24 * 60 * 60 * 1000;
const PROFILE_TTL = 30 * 24 * 60 * 60 * 1000;

function profileCacheKey(targetDid: string, viewerDid: string | null): string {
  return viewerDid ? "profile:" + viewerDid + ":" + targetDid : "profile:pub:" + targetDid;
}

export async function getProfile({
  ctx,
  did,
  publicOnly,
}: {
  ctx: AppContext;
  did: string;
  publicOnly?: boolean;
}): Promise<ProfileViewDetailed | null> {
  const sessionClient = publicOnly ? null : await ctx.getSessionAgent();
  const client = sessionClient ? sessionClient : new Client({ handler: publicHandler });
  const cacheKey = profileCacheKey(did, sessionClient?.did ?? null);
  const profile = await readThroughCache<ProfileViewDetailed | null>(
    ctx.kv,
    cacheKey,
    async () => {
      try {
        const actorParam = did as ActorIdentifier;
        const res = sessionClient
          ? await sessionClient.get("app.bsky.actor.getProfile", {
              params: { actor: actorParam },
              headers: { "atproto-proxy": "did:web:api.bsky.app#bsky_appview" },
            })
          : await client.get("app.bsky.actor.getProfile", {
              params: { actor: actorParam },
            });
        const profile = res.ok ? (res.data as ProfileViewDetailed) : null;
        if (profile?.did && profile?.handle) {
          await setIdentityCache(ctx.kv, profile.did, profile.handle);
        }
        return profile;
      } catch {
        return null;
      }
    },
    undefined,
    { revalidateAfter: REVALIDATE_AFTER, ttl: PROFILE_TTL },
  );
  return profile;
}

export async function getProfiles({
  ctx,
  dids,
  publicOnly,
}: {
  ctx: AppContext;
  dids: string[];
  publicOnly?: boolean;
}): Promise<ProfileViewDetailed[]> {
  dids = Array.from(new Set(dids));
  const sessionClient = publicOnly ? null : await ctx.getSessionAgent();
  const client = sessionClient ? sessionClient : new Client({ handler: publicHandler });
  const viewerDid = sessionClient?.did ?? null;

  const now = Date.now();
  const entries = await Promise.all(
    dids.map(async (did) => {
      const key = profileCacheKey(did, viewerDid);
      const [value, meta] = await Promise.all([
        ctx.kv.get<ProfileViewDetailed | null>(key),
        ctx.kv.getMeta(key),
      ]);
      const timestamp = meta && typeof meta["timestamp"] === "number" ? meta["timestamp"] : null;
      const age = timestamp !== null ? now - timestamp : Infinity;
      const isFresh = value !== null && timestamp !== null && age < REVALIDATE_AFTER;
      const isStale =
        value !== null && timestamp !== null && age >= REVALIDATE_AFTER && age < PROFILE_TTL;
      return { did, key, value, isFresh, isStale };
    }),
  );

  const fetchDids = entries.filter((e) => !e.isFresh).map((e) => e.did);

  if (fetchDids.length > 0) {
    try {
      const actorsParam = fetchDids as ActorIdentifier[];
      const res = sessionClient
        ? await sessionClient.get("app.bsky.actor.getProfiles", {
            params: { actors: actorsParam },
            headers: { "atproto-proxy": "did:web:api.bsky.app#bsky_appview" },
          })
        : await client.get("app.bsky.actor.getProfiles", {
            params: { actors: actorsParam },
          });
      const fetchedProfiles = res.ok
        ? (res.data as { profiles: ProfileViewDetailed[] }).profiles
        : [];

      for (const entry of entries) {
        if (!entry.isFresh && entry.value === null) {
          entry.value = fetchedProfiles.find((f) => f.did === entry.did) ?? null;
        }
      }

      const writeTimestamp = Date.now();
      Promise.all(
        fetchedProfiles.flatMap((p) => {
          const key = profileCacheKey(p.did, viewerDid);
          return [ctx.kv.set(key, p), ctx.kv.setMeta(key, { timestamp: writeTimestamp })];
        }),
      ).catch(() => {});
      await Promise.all(
        fetchedProfiles
          .filter((p) => p.did && p.handle)
          .map((p) => setIdentityCache(ctx.kv, p.did!, p.handle!)),
      );
    } catch {
      // Timeout or network failure — return whatever we had cached.
    }
  }

  return entries
    .filter((e): e is typeof e & { value: ProfileViewDetailed } => e.value !== null)
    .map((e) => e.value);
}
