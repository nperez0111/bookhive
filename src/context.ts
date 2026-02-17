import type { ProfileViewDetailed } from "./types";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { Did } from "@atcute/lexicons";
import type { OAuthClient } from "@atcute/oauth-node-client";
import type { Ingester } from "./bsky/ingester";
import type { Context } from "hono";
import { Hono } from "hono";
import { endTime, startTime } from "hono/timing";
import { getIronSession } from "iron-session";
import type { Logger } from "pino";
import { createStorage, type Storage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

import {
  createOAuthClient,
  sessionClientFromOAuthSession,
  type SessionClient,
} from "./auth/client";
import { getSessionConfig } from "./auth/router";
import {
  createBaseIdResolver,
  createBidirectionalResolverAtcute,
  createCachingBaseIdResolver,
  createCachingBidirectionalResolver,
} from "./bsky/id-resolver";
import type { BidirectionalResolver } from "./bsky/id-resolver";
import { createIngester } from "./bsky/ingester";
import type { Database } from "./db";
import { createDb, migrateToLatest } from "./db";
import { env } from "./env";
import { getLogger } from "./logger/index.ts";
import sqliteKv from "./sqlite-kv.ts";
import { lazy } from "./utils/lazy";
import { readThroughCache } from "./utils/readThroughCache";

/** Add business context to the single wide event emitted at request end. Prefer this over logger.info in handlers. */
export type AddWideEventContext = (context: Record<string, unknown>) => void;

// Application state passed to the router and elsewhere. No logger – request observability is via addWideEventContext + wide-event middleware.
export type AppContext = {
  db: Database;
  kv: Storage;
  ingester: Ingester;
  oauthClient: OAuthClient;
  resolver: BidirectionalResolver;
  baseIdResolver: ReturnType<typeof createBaseIdResolver>;
  getSessionAgent: () => Promise<SessionClient | null>;
  getProfile: () => Promise<ProfileViewDetailed | null>;
  /** Add fields to the one wide event logged per request (observability). */
  addWideEventContext: AddWideEventContext;
};

import type { BundleAssetUrls } from "./bundle-assets";

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
  Variables: {
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
};

export async function createAppDeps(): Promise<AppDeps> {
  const logger = getLogger({
    name: "server",
    redact: {
      paths: ["req.headers.cookie"],
      censor: "***REDACTED***",
    },
  });

  const db = createDb(env.DB_PATH);
  await migrateToLatest(db);

  const kv = createStorage({
    driver: sqliteKv({ location: env.KV_DB_PATH, table: "kv" }),
  });

  if (env.isProd) {
    kv.mount("search:", lruCacheDriver({ max: 1000 }));
  }
  kv.mount(
    "profile:",
    sqliteKv({ location: env.KV_DB_PATH, table: "profile" }),
  );
  kv.mount(
    "identity:",
    sqliteKv({ location: env.KV_DB_PATH, table: "identity" }),
  );
  kv.mount(
    "follows_sync:",
    sqliteKv({ location: env.KV_DB_PATH, table: "follows_sync" }),
  );
  kv.mount(
    "auth_session:",
    sqliteKv({
      location: env.isDevelopment ? "./auth.sqlite" : env.KV_DB_PATH,
      table: "auth_sessions",
    }),
  );
  kv.mount(
    "auth_state:",
    sqliteKv({
      location: env.isDevelopment ? "./auth.sqlite" : env.KV_DB_PATH,
      table: "auth_state",
    }),
  );
  kv.mount("book_lock:", lruCacheDriver({ max: 1000 }));

  const oauthClient = await createOAuthClient(kv);
  const baseIdResolver = createCachingBaseIdResolver(
    kv,
    createBaseIdResolver(),
  );
  const ingester = createIngester(db, kv, (wideEvent) =>
    logger.info(wideEvent),
  );
  const resolver = createCachingBidirectionalResolver(
    kv,
    createBidirectionalResolverAtcute(),
  );

  ingester.start();

  return {
    db,
    kv,
    logger,
    oauthClient,
    baseIdResolver,
    ingester,
    resolver,
  };
}

/** Optional timing callbacks for server-timing breakdown (session_iron, session_restore, session_save). */
export type SessionTiming = {
  start: (name: string) => void;
  end: (name: string) => void;
};

const SESSION_CLIENT_CACHE_TTL_MS = 30_000; // 30s in-memory cache to avoid restore+getTokenInfo on every request
const sessionClientCache = new Map<
  string,
  { client: SessionClient; expiresAt: number }
>();

function getCachedSessionClient(did: string): SessionClient | null {
  const entry = sessionClientCache.get(did);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.client;
}

function setCachedSessionClient(did: string, client: SessionClient): void {
  sessionClientCache.set(did, {
    client,
    expiresAt: Date.now() + SESSION_CLIENT_CACHE_TTL_MS,
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
    return cached;
  }

  try {
    timing?.start("session_restore");
    const oauthSession = await ctx.oauthClient.restore(session.did as Did, {
      refresh: "auto",
    });
    timing?.end("session_restore");

    // Don't await getTokenInfo: OAuthSession.handle() calls getTokenSet('auto') on first
    // request, so the token is loaded/refreshed when we first use the client (e.g. getProfile).

    timing?.start("session_save");
    session.updateConfig(getSessionConfig());
    await session.save();
    timing?.end("session_save");

    const client = sessionClientFromOAuthSession(oauthSession);
    setCachedSessionClient(session.did, client);
    return client;
  } catch (err) {
    ctx.addWideEventContext({
      oauth_restore: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    await session.destroy();
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
    const sessionLazy = lazy(() =>
      getSessionAgent(c.req.raw, c.res, ctx, sessionTiming).then((client) => {
        if (client) {
          ctx.addWideEventContext({ userDid: client.did });
        }
        return client;
      }),
    );
    const profileLazy = lazy(async () => {
      startTime(c, "get_profile_session");
      const client = await sessionLazy.value;
      endTime(c, "get_profile_session");
      if (!client?.did) {
        return null;
      }
      startTime(c, "get_profile_cache");
      const result = await readThroughCache<ProfileViewDetailed | null>(
        deps.kv,
        "profile:" + client.did,
        async () => {
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
      );
      endTime(c, "get_profile_cache");
      return result;
    });
    c.set("ctx", ctx);
    await next();
  };
}
