import { Client } from "@atcute/client";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import { setIdentityCache } from "../bsky/id-resolver";
import type { ProfileViewDetailed } from "../types";
import { readThroughCache } from "./readThroughCache";
import type { AppContext } from "../context";

/** Public fetch handler for unauthenticated XRPC (e.g. appview). */
const publicHandler = {
  handle: (path: string, init?: RequestInit) =>
    fetch(new URL(path, "https://public.api.bsky.app").toString(), init),
};

export async function getProfile({
  ctx,
  did,
}: {
  ctx: AppContext;
  did: string;
}): Promise<ProfileViewDetailed | null> {
  const sessionClient = await ctx.getSessionAgent();
  const client = sessionClient
    ? sessionClient
    : new Client({ handler: publicHandler });
  const profile = await readThroughCache<ProfileViewDetailed | null>(
    ctx.kv,
    "profile:" + did,
    async () => {
      try {
        const actorParam = did as ActorIdentifier;
        const res = sessionClient
          ? await sessionClient.get("app.bsky.actor.getProfile", {
              params: { actor: actorParam },
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
  );
  return profile;
}

export async function getProfiles({
  ctx,
  dids,
}: {
  ctx: AppContext;
  dids: string[];
}): Promise<ProfileViewDetailed[]> {
  dids = Array.from(new Set(dids));
  const profiles = await ctx.kv.getItems<ProfileViewDetailed | null>(
    dids.map((did) => "profile:" + did),
  );
  const sessionClient = await ctx.getSessionAgent();
  const client = sessionClient
    ? sessionClient
    : new Client({ handler: publicHandler });

  const missingProfiles = profiles
    .filter((p) => p.value === null)
    .map((p) => p.key.slice("profile:".length));

  if (missingProfiles.length > 0) {
    const actorsParam = missingProfiles as ActorIdentifier[];
    const res = sessionClient
      ? await sessionClient.get("app.bsky.actor.getProfiles", {
          params: { actors: actorsParam },
        })
      : await client.get("app.bsky.actor.getProfiles", {
          params: { actors: actorsParam },
        });
    const fetchedProfiles = res.ok
      ? (res.data as { profiles: ProfileViewDetailed[] }).profiles
      : [];

    profiles.forEach((p) => {
      if (p.value === null) {
        p.value =
          fetchedProfiles.find(
            (f) => f.did === p.key.slice("profile:".length),
          ) || null;
      }
    });

    ctx.kv.setItems(
      fetchedProfiles.map((p) => ({ key: "profile:" + p.did, value: p })),
    );
    await Promise.all(
      fetchedProfiles
        .filter((p) => p.did && p.handle)
        .map((p) => setIdentityCache(ctx.kv, p.did!, p.handle!)),
    );
  }

  return profiles
    .filter((p): p is { key: string; value: ProfileViewDetailed } =>
      Boolean(p.value),
    )
    .map((p) => p.value);
}
