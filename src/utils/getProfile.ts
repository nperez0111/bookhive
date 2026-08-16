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
  const profile = await readThroughCache<ProfileViewDetailed | null>(
    ctx.kv,
    "profile:" + did,
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
    { revalidateAfter: 24 * 60 * 60 * 1000, ttl: 30 * 24 * 60 * 60 * 1000 },
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
  const profiles = await ctx.kv.getItems<ProfileViewDetailed | null>(
    dids.map((did) => "profile:" + did),
  );
  const sessionClient = publicOnly ? null : await ctx.getSessionAgent();
  const client = sessionClient ? sessionClient : new Client({ handler: publicHandler });

  const missingProfiles = profiles
    .filter((p) => p.value === null)
    .map((p) => p.key.slice("profile:".length));

  if (missingProfiles.length > 0) {
    try {
      const actorsParam = missingProfiles as ActorIdentifier[];
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

      profiles.forEach((p) => {
        if (p.value === null) {
          p.value = fetchedProfiles.find((f) => f.did === p.key.slice("profile:".length)) || null;
        }
      });

      void ctx.kv.setItems(fetchedProfiles.map((p) => ({ key: "profile:" + p.did, value: p })));
      await Promise.all(
        fetchedProfiles
          .filter((p) => p.did && p.handle)
          .map((p) => setIdentityCache(ctx.kv, p.did!, p.handle!)),
      );
    } catch {
      // Timeout or network failure — return whatever we had cached.
    }
  }

  return profiles
    .filter((p): p is { key: string; value: ProfileViewDetailed } => Boolean(p.value))
    .map((p) => p.value);
}
