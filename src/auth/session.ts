import type { SessionOptions } from "iron-session";

import { env } from "../env";
import type { SessionClient } from "./client";
import { SessionCache } from "./sessionCache";

// The iron-session cookie config and in-process `SessionClient` cache — split
// out because `context.ts` and `auth/router.tsx` both need them, and having
// each import the other's value created the only genuine ESM cycle in `src/`.

/** Cookie name + options. `sid` is load-bearing: the whole caching policy keys on it. */
export function getSessionConfig(): SessionOptions {
  return {
    cookieName: "sid",
    password: env.COOKIE_SECRET,
    ttl: 60 * 60 * 24 * 180, // 180 days — match confidential OAuth client session length
    cookieOptions: {
      // For localhost development, we need to disable secure flag
      secure: env.NODE_ENV === "production",
      // Ensure SameSite is set to Lax for cross-origin redirects
      sameSite: "lax",
      // Allow cookies to work across localhost ports
      httpOnly: true,
    },
  };
}

const sessionClientCache = new SessionCache<SessionClient>();
// Expire dormant DIDs too; an unref'ed timer must not keep a worker alive at shutdown.
setInterval(() => sessionClientCache.prune(), 60_000).unref();

/** Fixed-cardinality snapshot; no DID or client contents escape into monitoring. */
export function getSessionCacheStats() {
  return sessionClientCache.stats();
}

export function getCachedSessionClient(
  did: string,
): { client: SessionClient; needsSave: boolean } | null {
  return sessionClientCache.get(did);
}

export function setCachedSessionClient(
  did: string,
  client: SessionClient,
  tokenExpiresAt: number | undefined,
): void {
  sessionClientCache.set(did, client, tokenExpiresAt);
}

/** Drop a cached client — the session was deleted upstream, so re-restore. */
export function evictCachedSessionClient(did: string): void {
  sessionClientCache.delete(did);
}

/** Record that the iron-session cookie was just re-saved, resetting the 24h timer. */
export function markSessionSaved(did: string): void {
  sessionClientCache.markSaved(did);
}
