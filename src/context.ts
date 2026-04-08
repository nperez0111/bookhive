import type { ProfileViewDetailed } from "./types";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { Did } from "@atcute/lexicons";
import type { OAuthClient } from "@atcute/oauth-node-client";
import type { Ingester } from "./bsky/ingester";
import type { Context } from "hono";
import { Hono } from "hono";
import { endTime, startTime, type TimingVariables } from "hono/timing";
import { getIronSession } from "iron-session";
import type { Logger } from "pino";
import { createStorage, type Storage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

import {
  createOAuthClient,
  sessionClientFromOAuthSession,
  type SessionClient,
} from "./auth/client";
import { createServiceAccountAgent } from "./utils/catalogBookService";
import { getSessionConfig } from "./auth/router";
import {
  createBaseIdResolver,
  createBidirectionalResolverAtcute,
  createCachingBaseIdResolver,
  createCachingBidirectionalResolver,
} from "./bsky/id-resolver";
import type { BidirectionalResolver } from "./bsky/id-resolver";
import type { Database } from "./db";
import { createDb, migrateToLatest } from "./db";
import { env } from "./env";
import { getLogger } from "./logger/index.ts";
import sqliteKv, { createSharedKvDb } from "./sqlite-kv.ts";
import { lazy } from "./utils/lazy";
import { readThroughCache } from "./utils/readThroughCache";

/** Add business context to the single wide event emitted at request end. Prefer this over logger.info in handlers. */
export type AddWideEventContext = (context: Record<string, unknown>) => void;

/** Minimal context needed by shared book utilities (getBook, ensureBookCataloged, etc.). */
export type BookUtilContext = {
  db: Database;
  kv: Storage;
  serviceAccountAgent: SessionClient | null;
  addWideEventContext: AddWideEventContext;
};

// Application state passed to the router and elsewhere. No logger – request observability is via addWideEventContext + wide-event middleware.
export type AppContext = {
  db: Database;
  kv: Storage;
  ingester: Ingester;
  oauthClient: OAuthClient;
  resolver: BidirectionalResolver;
  baseIdResolver: ReturnType<typeof createBaseIdResolver>;
  /** Cheap DID lookup from iron-session cookie — no OAuth restore, no network calls. */
  getSessionDid: () => Promise<string | null>;
  getSessionAgent: () => Promise<SessionClient | null>;
  getProfile: () => Promise<ProfileViewDetailed | null>;
  /** Service account agent for @bookhive.buzz ATProto writes. Null if env vars not set. */
  serviceAccountAgent: SessionClient | null;
  /** Add fields to the one wide event logged per request (observability). */
  addWideEventContext: AddWideEventContext;
};

import type { BundleAssetUrls } from "./utils/manifest";

declare module "hono" {
  interface ContextVariableMap {
    ctx: AppContext;
    assetUrls: BundleAssetUrls | null;
    /** Request ID (UUID); set by wide-event middleware for the rest of the request. */
    requestId: string;
    /** Mutable bag for wide-event context; merged into the single request log. */
    wideEventBag: Record<string, unknown>;
    /** App logger; only wide-event middleware should call it for request-scoped logs. */
    appLogger: Logger;
    /** Set by error-capture middleware (thrown) or by handlers (caught then return 5xx); included in wide-event log. */
    requestError?: unknown;
  }
}

export type AppEnv = {
  Variables: TimingVariables & {
    ctx: AppContext;
    assetUrls: BundleAssetUrls | null;
    requestId: string;
    appLogger: Logger;
    requestError?: unknown;
  };
};

export type HonoServer = Hono<AppEnv>;

export type Session = { did: string };

/** Long-lived dependencies created at server startup (no request-scoped helpers). */
export type AppDeps = {
  db: Database;
  kv: Storage;
  logger: Logger;
  oauthClient: OAuthClient;
  baseIdResolver: ReturnType<typeof createBaseIdResolver>;
  ingester: Ingester;
  resolver: BidirectionalResolver;
  serviceAccountAgent: SessionClient | null;
};

export async function createAppDeps(): Promise<AppDeps> {
  const logger = getLogger({
    name: "server",
    redact: {
      paths: ["req.headers.cookie"],
      censor: "***REDACTED***",
    },
  });

  const { db, sqlite } = createDb(env.DB_PATH);
  logger.info("starting DB migrations");
  const migrationStart = Date.now();
  const migrationResults = await migrateToLatest(db, sqlite);
  logger.info({ durationMs: Date.now() - migrationStart }, "db migrations completed");
  if (migrationResults.length > 0) {
    logger.info(
      { migrations: migrationResults.map((r) => r.migrationName) },
      "migrations applied, deferring VACUUM to background",
    );
    // Run VACUUM in the background — it reclaims space but shouldn't block server startup.
    setTimeout(() => {
      const vacuumStart = Date.now();
      sqlite.exec("VACUUM");
      logger.info({ durationMs: Date.now() - vacuumStart }, "db VACUUM complete");
    }, 5_000);
  }

  // Single shared connection for all KV tables on KV_DB_PATH.
  const kvDb = createSharedKvDb(env.KV_DB_PATH);
  const kv = createStorage({
    driver: sqliteKv({ table: "kv", db: kvDb }),
  });

  if (env.isProd) {
    kv.mount("search:", lruCacheDriver({ max: 1000 }));
  }
  kv.mount("profile:", sqliteKv({ table: "profile", db: kvDb }));
  kv.mount("identity:", sqliteKv({ table: "identity", db: kvDb }));
  kv.mount("follows_sync:", sqliteKv({ table: "follows_sync", db: kvDb }));

  // Auth tables: in development use a separate file; in production share the main KV connection.
  const authKvDb = env.isDevelopment ? createSharedKvDb("./auth.sqlite") : kvDb;
  kv.mount("auth_session:", sqliteKv({ table: "auth_sessions", db: authKvDb }));
  kv.mount("auth_state:", sqliteKv({ table: "auth_state", db: authKvDb }));
  kv.mount("book_lock:", lruCacheDriver({ max: 1000 }));

  const oauthClient = await createOAuthClient(kv);
  const baseIdResolver = createCachingBaseIdResolver(kv, createBaseIdResolver());
  const resolver = createCachingBidirectionalResolver(kv, createBidirectionalResolverAtcute());

  const serviceAccountAgent =
    env.BOOKHIVE_SERVICE_HANDLE && env.BOOKHIVE_APP_PASSWORD
      ? await createServiceAccountAgent(env.BOOKHIVE_SERVICE_HANDLE, env.BOOKHIVE_APP_PASSWORD)
      : null;

  // When running the Nitro bundle (.output/server/index.mjs), load the pre-built worker.
  // In dev, Bun runs the .ts source directly.
  const isBundled = import.meta.url.includes(".output/");
  const workerUrl = isBundled
    ? new URL("./workers/ingester-worker.js", import.meta.url).href
    : new URL("./workers/ingester-worker.ts", import.meta.url).href;
  const ingesterWorker = new Worker(workerUrl);
  ingesterWorker.onmessage = (event: MessageEvent) => {
    if (event.data.type === "wideEvent") {
      logger.info(event.data.payload);
    } else if (event.data.type === "ready") {
      logger.info("ingester worker ready");
    }
  };
  ingesterWorker.onerror = (event) => {
    logger.error({ error: event.message }, "ingester worker error");
  };
  const ingester: Ingester = {
    start() {},
    destroy() {
      ingesterWorker.terminate();
      return Promise.resolve();
    },
  };

  return {
    db,
    kv,
    logger,
    oauthClient,
    baseIdResolver,
    ingester,
    resolver,
    serviceAccountAgent,
  };
}

/** Optional timing callbacks for server-timing breakdown (session_iron, session_restore, session_save). */
export type SessionTiming = {
  start: (name: string) => void;
  end: (name: string) => void;
};

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

function getCachedSessionClient(did: string): { client: SessionClient; needsSave: boolean } | null {
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

// Helper function to get the session client for the active session
export async function getSessionAgent(
  req: Request,
  res: Response,
  ctx: AppContext,
  timing?: SessionTiming,
): Promise<SessionClient | null> {
  timing?.start("session_iron");
  const session = await getIronSession<Session>(req, res, getSessionConfig());
  timing?.end("session_iron");

  if (!session.did) {
    return null;
  }

  const cached = getCachedSessionClient(session.did);
  if (cached) {
    ctx.addWideEventContext({ session_cache: "hit" });
    // Periodically re-save the iron-session cookie to keep its 180-day TTL rolling.
    if (cached.needsSave) {
      session.updateConfig(getSessionConfig());
      await session.save();
      const entry = sessionClientCache.get(session.did);
      if (entry) entry.lastSaveAt = Date.now();
    }
    return cached.client;
  }

  try {
    timing?.start("session_restore");
    const oauthSession = await ctx.oauthClient.restore(session.did as Did, {
      refresh: "auto",
    });
    timing?.end("session_restore");

    // Get token expiration so we can cache until just before it expires.
    // This is cheap: reads from the session store with allowStale (no network calls).
    const tokenInfo = await oauthSession.getTokenInfo(false);
    const tokenExpiresAt = tokenInfo.expiresAt?.getTime();

    ctx.addWideEventContext({
      session_cache: "miss",
      token_expires_in_ms: tokenExpiresAt ? tokenExpiresAt - Date.now() : undefined,
    });

    timing?.start("session_save");
    session.updateConfig(getSessionConfig());
    await session.save();
    timing?.end("session_save");

    const client = sessionClientFromOAuthSession(oauthSession);
    setCachedSessionClient(session.did, client, tokenExpiresAt);
    return client;
  } catch (err) {
    ctx.addWideEventContext({
      oauth_restore: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    session.destroy();
    return null;
  }
}

/** Middleware that sets request-scoped AppContext (deps + getSessionAgent, getProfile). Use on any Hono app that needs c.get("ctx"). */
export function createContextMiddleware(deps: AppDeps) {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    c.set("wideEventBag", {});
    c.set("appLogger", deps.logger);

    const { logger: _logger, ...restDeps } = deps;
    const ctx: AppContext = {
      ...restDeps,
      addWideEventContext(context: Record<string, unknown>) {
        Object.assign(c.get("wideEventBag"), context);
      },
      getSessionDid(): Promise<string | null> {
        return didLazy.value;
      },
      getSessionAgent(): Promise<SessionClient | null> {
        return sessionLazy.value;
      },
      async getProfile(): Promise<ProfileViewDetailed | null> {
        return profileLazy.value as Promise<ProfileViewDetailed | null>;
      },
    };
    const sessionTiming: SessionTiming = {
      start: (name) => startTime(c, name),
      end: (name) => endTime(c, name),
    };

    // Fast path: read DID from iron-session cookie only (no OAuth restore).
    const didLazy = lazy(async () => {
      startTime(c, "session_iron");
      const session = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());
      endTime(c, "session_iron");
      return session.did || null;
    });

    const sessionLazy = lazy(() =>
      getSessionAgent(c.req.raw, c.res, ctx, sessionTiming).then((client) => {
        if (client) {
          ctx.addWideEventContext({ userDid: client.did });
        }
        return client;
      }),
    );

    // getProfile uses the fast DID path for cache lookups.
    // The expensive OAuth restore only happens on profile cache miss.
    const profileLazy = lazy(async () => {
      startTime(c, "get_profile_did");
      const did = await didLazy.value;
      endTime(c, "get_profile_did");
      if (!did) {
        return null;
      }
      ctx.addWideEventContext({ userDid: did });

      startTime(c, "get_profile_cache");
      const result = await readThroughCache<ProfileViewDetailed | null>(
        deps.kv,
        "profile:" + did,
        async () => {
          // Cache miss — need a full session to call the Bluesky API.
          startTime(c, "get_profile_session");
          const client = await sessionLazy.value;
          endTime(c, "get_profile_session");
          if (!client) throw new Error("session_unavailable");
          startTime(c, "get_profile_network");
          try {
            const res = await client.get("app.bsky.actor.getProfile", {
              params: { actor: client.did as ActorIdentifier },
            });
            if (!res.ok) return null;
            return res.data as ProfileViewDetailed | null;
          } finally {
            endTime(c, "get_profile_network");
          }
        },
        undefined,
        { revalidateAfter: 24 * 60 * 60 * 1000, ttl: 30 * 24 * 60 * 60 * 1000 },
      );
      endTime(c, "get_profile_cache");

      // Fire off session restore in the background so it's warm for subsequent API calls,
      // and to keep the iron-session cookie's rolling TTL fresh even on cache hits.
      const cached = getCachedSessionClient(did);
      if (!cached || cached.needsSave) {
        sessionLazy.value.catch(() => {});
      }

      return result;
    });
    c.set("ctx", ctx);
    await next();
  };
}
