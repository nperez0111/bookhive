import { isDid } from "@atcute/lexicons/syntax";

/**
 * The one "turn a `:handle` route param into a DID" — uses `isDid` rather than
 * an ad-hoc `startsWith("did:")` check, which admits malformed DIDs.
 * Returns `null` instead of throwing since callers render a miss differently.
 */
export type ActorResolverContext = {
  baseIdResolver: { handle: { resolve: (handle: string) => Promise<string | undefined> } };
};

export async function resolveActorDid(
  ctx: ActorResolverContext,
  handleOrDid: string,
): Promise<string | null> {
  if (!handleOrDid) return null;
  if (isDid(handleOrDid)) return handleOrDid;
  return (await ctx.baseIdResolver.handle.resolve(handleOrDid)) ?? null;
}
