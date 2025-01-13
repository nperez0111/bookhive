import { Agent } from "@atproto/api";
import { readThroughCache } from "./readThroughCache";
import type { AppContext } from "..";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { getLogger } from "../logger";

const logger = getLogger({ name: "kv-cache" });

export async function getProfile({
  ctx,
  did,
}: {
  ctx: AppContext;
  did: string;
}): Promise<ProfileViewDetailed | null> {
  const agent =
    (await ctx.getSessionAgent()) ||
    new Agent("https://public.api.bsky.app/xrpc");
  const profile = await readThroughCache(ctx.kv, "profile:" + did, async () => {
    logger.trace({ did }, "getProfile fetch");
    return agent
      .getProfile({
        actor: did,
      })
      .then((res) => res.data);
  });
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
  const agent =
    (await ctx.getSessionAgent()) ||
    new Agent("https://public.api.bsky.app/xrpc");

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
    const fetchedProfiles = await agent
      .getProfiles({
        actors: missingProfiles,
      })
      .then((res) => res.data.profiles);

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
