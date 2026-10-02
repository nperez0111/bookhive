import type { SessionOptions } from "iron-session";

import { env } from "../env";
import type { SessionClient } from "./client";

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

const MAX_CACHE_TTL_MS = 10 * 60 * 1000; // 10-minute cap on session cache
const MIN_CACHE_TTL_MS = 10_000; // 10-second minimum
const TOKEN_EXPIRY_BUFFER_MS = 60_000; // re-restore 60s before token expires
const SESSION_SAVE_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-save iron-session cookie every 24h

type CachedSession = {
  client: SessionClient;
  /** When this cache entry should be evicted (triggers a fresh restore). */
  expiresAt: number;
  /** Last time we called session.save() to extend the iron-session cookie TTL. */
  lastSaveAt: number;
};

const sessionClientCache = new Map<string, CachedSession>();

export function getCachedSessionClient(
  did: string,
): { client: SessionClient; needsSave: boolean } | null {
  const entry = sessionClientCache.get(did);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessionClientCache.delete(did);
    return null;
  }
  return {
    client: entry.client,
    needsSave: Date.now() - entry.lastSaveAt > SESSION_SAVE_INTERVAL_MS,
  };
}

export function setCachedSessionClient(
  did: string,
  client: SessionClient,
  tokenExpiresAt: number | undefined,
): void {
  const now = Date.now();
  let ttl = MAX_CACHE_TTL_MS;
  if (tokenExpiresAt) {
    const timeUntilExpiry = tokenExpiresAt - now - TOKEN_EXPIRY_BUFFER_MS;
    ttl = Math.max(MIN_CACHE_TTL_MS, Math.min(timeUntilExpiry, MAX_CACHE_TTL_MS));
  }
  sessionClientCache.set(did, {
    client,
    expiresAt: now + ttl,
    lastSaveAt: now,
  });
}

/** Drop a cached client — the session was deleted upstream, so re-restore. */
export function evictCachedSessionClient(did: string): void {
  sessionClientCache.delete(did);
}

/** Record that the iron-session cookie was just re-saved, resetting the 24h timer. */
export function markSessionSaved(did: string): void {
  const entry = sessionClientCache.get(did);
  if (entry) entry.lastSaveAt = Date.now();
}
