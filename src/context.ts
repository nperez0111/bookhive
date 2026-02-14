import type { ProfileViewDetailed } from "./types";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { Did } from "@atcute/lexicons";
import type { OAuthClient } from "@atcute/oauth-node-client";
import type { Ingester } from "./bsky/ingester";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Env } from "hono-pino";
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

// Application state passed to the router and elsewhere
export type AppContext = {
  db: Database;
  kv: Storage;
  ingester: Ingester;
  logger: Logger;
  oauthClient: OAuthClient;
  resolver: BidirectionalResolver;
  baseIdResolver: ReturnType<typeof createBaseIdResolver>;
  getSessionAgent: () => Promise<SessionClient | null>;
  getProfile: () => Promise<ProfileViewDetailed | null>;
};

import type { BundleAssetUrls } from "./bundle-assets";

declare module "hono" {
  interface ContextVariableMap {
    ctx: AppContext;
    assetUrls: BundleAssetUrls | null;
  }
}

export type AppEnv = {
  Variables: {
    ctx: AppContext;
    assetUrls: BundleAssetUrls | null;
  } & Env["Variables"];
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
  const ingester = createIngester(db, kv);
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

// Helper function to get the session client for the active session
export async function getSessionAgent(
  req: Request,
  res: Response,
  ctx: AppContext,
): Promise<SessionClient | null> {
  const session = await getIronSession<Session>(req, res, getSessionConfig());

  if (!session.did) {
    return null;
  }

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did as Did, {
      refresh: "auto",
    });
    await oauthSession.getTokenInfo("auto");
    session.updateConfig(getSessionConfig());
    await session.save();
    return sessionClientFromOAuthSession(oauthSession);
  } catch (err) {
    ctx.logger.warn({ err }, "oauth restore failed");
    await session.destroy();
    return null;
  }
}

/** Middleware that sets request-scoped AppContext (deps + getSessionAgent, getProfile). Use on any Hono app that needs c.get("ctx"). */
export function createContextMiddleware(deps: AppDeps) {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const ctx: AppContext = {
      ...deps,
      getSessionAgent(): Promise<SessionClient | null> {
        return lazy(() =>
          getSessionAgent(c.req.raw, c.res, ctx).then((client) => {
            if (client) {
              c.var.logger.assign({ userDid: client.did });
            }
            return client;
          }),
        ).value;
      },
      async getProfile(): Promise<ProfileViewDetailed | null> {
        return lazy(async () => {
          const client = await getSessionAgent(c.req.raw, c.res, ctx);
          if (!client?.did) {
            return null;
          }
          return readThroughCache<ProfileViewDetailed | null>(
            deps.kv,
            "profile:" + client.did,
            async () => {
              const res = await client.get("app.bsky.actor.getProfile", {
                params: { actor: client.did as ActorIdentifier },
              });
              if (!res.ok) return null;
              return res.data as ProfileViewDetailed | null;
            },
          );
        }).value as Promise<ProfileViewDetailed | null>;
      },
    };
    c.set("ctx", ctx);
    await next();
  };
}
