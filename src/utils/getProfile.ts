import { Client } from "@atcute/client";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { ProfileViewDetailed } from "../types";
import { readThroughCache } from "./readThroughCache";
import type { AppContext } from "..";
import { getLogger } from "../logger";

const logger = getLogger({ name: "kv-cache" });

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
      logger.trace({ did }, "getProfile fetch");
      try {
        const actorParam = did as ActorIdentifier;
        const res = sessionClient
          ? await sessionClient.get("app.bsky.actor.getProfile", {
              params: { actor: actorParam },
            })
          : await client.get("app.bsky.actor.getProfile", {
              params: { actor: actorParam },
            });
        return res.ok ? (res.data as ProfileViewDetailed) : null;
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

  logger.trace(
    {
      numberFound: profiles.length - missingProfiles.length,
      numberMissing: missingProfiles.length,
    },
    "found profiles",
  );

  if (missingProfiles.length > 0) {
    logger.trace({ dids: missingProfiles }, "getProfiles fetch");
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
  }

  return profiles
    .filter((p): p is { key: string; value: ProfileViewDetailed } =>
      Boolean(p.value),
    )
    .map((p) => p.value);
}
