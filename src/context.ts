import type { HiveId, ProfileViewDetailed } from "./types";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { Did } from "@atcute/lexicons";
import type { OAuthClient } from "@atcute/oauth-node-client";
import type { Ingester } from "./bsky/ingester";
import type { Context } from "hono";
import { Hono } from "hono";
import { endTime, startTime, type TimingVariables } from "hono/timing";
import { getIronSession } from "iron-session";
import { sql } from "kysely";
import type { Logger } from "pino";
import { createStorage, type Storage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

import {
  createOAuthClient,
  sessionClientFromOAuthSession,
  type SessionClient,
} from "./auth/client";
import { createCrossProcessLock } from "./auth/refresh-lock";
import { guardedRestore, isSessionTerminatingError } from "./auth/restore-guard";
import { getStoredSessionIssuerHost } from "./auth/storage";
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
import { PAGE_CACHE_TTL_MS } from "./middleware/anon-page-cache";
import { OG_CACHE_MAX_TTL_MS, publishOgCacheStats } from "./utils/ogCache";
import sqliteKv, { createSharedKvDb, incrementalVacuumKv, vacuumKvIfBloated } from "./sqlite-kv.ts";
import { startEnrichmentDrain } from "./utils/enrichQueue";
import { lazy } from "./utils/lazy";
import { readThroughCache } from "./utils/readThroughCache";
import { updateBookRecord } from "./utils/getBook";
import type { PendingWrite } from "./utils/syncBridge";

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
  /** Stops the primary worker's enrichment drain loop; no-op elsewhere. */
  stopEnrichmentDrain: () => void;
};

export async function createAppDeps(): Promise<AppDeps> {
  const logger = getLogger({
    name: "server",
    redact: {
      paths: ["req.headers.cookie"],
      censor: "***REDACTED***",
    },
  });

  // WORKER_INDEX is set by server/cluster.ts when running multiple processes.
  // Absent (dev, tests, bare `bun run .output/server/index.mjs`) => primary, for
  // back-compat. Only the primary runs migrations/VACUUM and the Jetstream
  // ingester; the supervisor starts the primary alone and waits for its
  // healthcheck before spawning siblings, so migrations are done before any
  // non-primary worker opens the DB.
  const isPrimaryWorker = !env.WORKER_INDEX || env.WORKER_INDEX === "0";
  logger.info({ workerIndex: env.WORKER_INDEX || "solo" }, "worker starting");

  const { db, sqlite } = createDb(env.DB_PATH);
  if (isPrimaryWorker) {
    logger.info("starting DB migrations");
    const migrationStart = Date.now();
    const migrationResults = await migrateToLatest(db, sqlite);
    logger.info({ durationMs: Date.now() - migrationStart }, "db migrations completed");
    if (migrationResults.length > 0) {
      logger.info(
        { migrations: migrationResults.map((r: { migrationName: string }) => r.migrationName) },
        "migrations applied, running VACUUM before siblings start",
      );
      const vacuumStart = Date.now();
      sqlite.exec("VACUUM");
      logger.info({ durationMs: Date.now() - vacuumStart }, "db VACUUM complete");
    }
  }

  // Single shared connection for all KV tables on KV_DB_PATH.
  const { db: kvDb, sqlite: kvSqlite } = createSharedKvDb(env.KV_DB_PATH);
  if (isPrimaryWorker) {
    // The KV is delete-heavy (page + OG caches, auth state, the sweeps below)
    // and had never been VACUUMed: 1.94 GB on disk for 34.7 MB of live rows,
    // 98.1% free pages. Runs before the siblings spawn, and only when the file
    // is actually bloated — deploys are frequent enough to keep it in check.
    vacuumKvIfBloated(kvSqlite, (fields, msg) => logger.info(fields, msg));
  }
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
  const authKvDb = env.isDevelopment ? createSharedKvDb("./auth.sqlite").db : kvDb;
  kv.mount("auth_session:", sqliteKv({ table: "auth_sessions", db: authKvDb }));
  kv.mount("auth_state:", sqliteKv({ table: "auth_state", db: authKvDb }));
  // Shared (not in-memory) so the main process and the ingester/import
  // workers see the same per-DID book locks.
  kv.mount("book_lock:", sqliteKv({ table: "book_lock", db: kvDb }));
  kv.mount("sync_pending:", sqliteKv({ table: "sync_pending", db: kvDb }));
  // Per-user KOSync token rotation counter (see src/middleware/sync-auth.ts).
  kv.mount("sync_token:", sqliteKv({ table: "sync_token", db: kvDb }));
  // Anonymous full-page HTML cache (see src/middleware/anon-page-cache.ts).
  kv.mount("page:", sqliteKv({ table: "page_cache", db: kvDb }));
  // Rendered OG cards (see src/routes/og.tsx). Shared so one render serves all
  // workers — this was a per-process unbounded Map holding webp bytes for up
  // to seven days.
  kv.mount("og:", sqliteKv({ table: "og_cache", db: kvDb }));
  if (isPrimaryWorker) {
    // Expire old cached pages so a bot sweep of the long tail can't grow the
    // KV file unboundedly. 2x TTL keeps recently-stale rows around for cheap
    // overwrite instead of insert.
    const pageCacheTimer = setInterval(
      () => {
        const cutoff = new Date(Date.now() - 2 * PAGE_CACHE_TTL_MS).toISOString();
        void sql`DELETE FROM page_cache WHERE updated_at < ${cutoff}`
          .execute(kvDb)
          .catch((e: any) => {
            if (String(e?.message).includes("no such table")) return;
            logger.error({ err: e }, "page_cache cleanup failed");
          });

        // Same idea for OG cards. The longest TTL is 7 days (TTL.STATIC), so
        // anything untouched for twice that is a card nothing links to any
        // more — a crawler sweep of the long tail must not grow the KV file
        // without bound.
        const ogCutoff = new Date(Date.now() - 2 * OG_CACHE_MAX_TTL_MS).toISOString();
        void sql`DELETE FROM og_cache WHERE updated_at < ${ogCutoff}`
          .execute(kvDb)
          .catch((e: any) => {
            if (String(e?.message).includes("no such table")) return;
            logger.error({ err: e }, "og_cache cleanup failed");
          });

        void publishOgCacheStats(kvDb).catch((e: any) => {
          if (String(e?.message).includes("no such table")) return;
          logger.error({ err: e }, "og_cache stats failed");
        });

        // Hand the pages those two DELETEs just freed back to the filesystem.
        // Bounded, so it can never become the multi-second stall a full VACUUM
        // would be on this timer.
        incrementalVacuumKv(kvSqlite);
      },
      15 * 60 * 1000,
    );
    pageCacheTimer.unref();
  }

  const requestLock = createCrossProcessLock(authKvDb);
  const oauthClient = await createOAuthClient(kv, { requestLock });
  const baseIdResolver = createCachingBaseIdResolver(kv, createBaseIdResolver());
  const resolver = createCachingBidirectionalResolver(kv, createBidirectionalResolverAtcute());

  const serviceAccountAgent =
    env.BOOKHIVE_SERVICE_HANDLE && env.BOOKHIVE_APP_PASSWORD
      ? await createServiceAccountAgent(env.BOOKHIVE_SERVICE_HANDLE, env.BOOKHIVE_APP_PASSWORD)
      : null;

  // Only the primary worker runs the Jetstream ingester — N copies would mean
  // N firehose subscriptions racing on the same DB rows and KV cursor.
  let ingester: Ingester;
  if (isPrimaryWorker) {
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
    ingester = {
      start() {},
      destroy() {
        ingesterWorker.terminate();
        return Promise.resolve();
      },
    };
  } else {
    ingester = {
      start() {},
      destroy: () => Promise.resolve(),
    };
  }

  // Goodreads enrichment is queued by every process but drained only here — one
  // WAF token cache and one writer, instead of N processes each fanning out a
  // scrape per search result (the 2026-08-01 OOM).
  const stopEnrichmentDrain = isPrimaryWorker ? startEnrichmentDrain({ db, logger }) : () => {};

  return {
    db,
    kv,
    logger,
    oauthClient,
    baseIdResolver,
    ingester,
    resolver,
    serviceAccountAgent,
    stopEnrichmentDrain,
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

/**
 * A cached SessionClient refreshes its token lazily, mid-request. When another
 * cluster process rotated that session first, the refresh throws
 * "session was deleted by another process" and the user got a 500 on an
 * otherwise fine page load.
 *
 * Treat it as retryable: drop the stale cache entry, restore the session once,
 * and replay the call against the fresh client. If that fails too, surface the
 * original error to the caller (which will handle it as an auth failure).
 */
const SESSION_DELETED_PATTERN = /session was deleted by another process/i;

/** DIDs currently inside a refresh retry — stops a replayed call from
 *  recursing when the restored client hits the same race again. */
const sessionRetryInFlight = new Set<string>();

function withSessionRefreshRetry(
  did: string,
  client: SessionClient,
  restore: () => Promise<SessionClient | null>,
): SessionClient {
  const wrap = <M extends "get" | "post">(method: M): SessionClient[M] =>
    (async (name: string, opts?: Record<string, unknown>) => {
      try {
        return await client[method](name, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!SESSION_DELETED_PATTERN.test(message)) throw err;
        if (sessionRetryInFlight.has(did)) throw err;

        sessionClientCache.delete(did);
        sessionRetryInFlight.add(did);
        try {
          const fresh = await restore().catch(() => null);
          if (!fresh) throw err;
          return await fresh[method](name, opts);
        } finally {
          sessionRetryInFlight.delete(did);
        }
      }
    }) as SessionClient[M];

  return {
    get did() {
      return client.did;
    },
    get: wrap("get"),
    post: wrap("post"),
  };
}

/**
 * Breaker key for a DID: the authorization-server host when we have a stored
 * session, else the DID itself. Falling back to the DID keeps a first-ever
 * restore guarded instead of unguarded.
 */
async function restoreGuardKey(ctx: { kv: Storage }, did: string): Promise<string> {
  return (await getStoredSessionIssuerHost(ctx.kv, did)) ?? did;
}

/** Restore a session client for a DID, bypassing the process cache. */
async function restoreSessionClient(ctx: AppContext, did: string): Promise<SessionClient | null> {
  try {
    const key = await restoreGuardKey(ctx, did);
    const oauthSession = await guardedRestore(key, () =>
      ctx.oauthClient.restore(did as Did, { refresh: "auto" }),
    );
    const tokenInfo = await oauthSession.getTokenInfo(false);
    // Same factory as the primary path, so a client that gets cached here can
    // still recover from a later rotation by another process.
    const client = withSessionRefreshRetry(did, sessionClientFromOAuthSession(oauthSession), () =>
      restoreSessionClient(ctx, did),
    );
    setCachedSessionClient(did, client, tokenInfo.expiresAt?.getTime());
    return client;
  } catch {
    return null;
  }
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

  const guardKey = await restoreGuardKey(ctx, session.did);

  try {
    timing?.start("session_restore");
    const oauthSession = await guardedRestore(
      guardKey,
      () => ctx.oauthClient.restore(session.did as Did, { refresh: "auto" }),
      (outcome) =>
        ctx.addWideEventContext({
          pds_host: outcome.key,
          pds_breaker: outcome.state,
          oauth_restore_ms: outcome.durationMs,
        }),
    );
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

    const did = session.did;
    const client = withSessionRefreshRetry(did, sessionClientFromOAuthSession(oauthSession), () =>
      restoreSessionClient(ctx, did),
    );
    setCachedSessionClient(did, client, tokenExpiresAt);
    return client;
  } catch (err) {
    // Only tear the session down when the PDS has actually rejected our
    // credentials. A timeout or an unreachable host says nothing about whether
    // the user is still logged in, and destroying on those silently signed
    // people out for the duration of their server's downtime (7 × 302 on
    // /library in 6h on 2026-08-02).
    const terminal = isSessionTerminatingError(err);
    ctx.addWideEventContext({
      oauth_restore: "failed",
      oauth_restore_terminal: terminal,
      pds_host: guardKey,
      error: err instanceof Error ? err.message : String(err),
    });
    if (terminal) session.destroy();
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
          void flushPendingSyncWrites(client, ctx);
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
          // Cache miss — need a full session to call the Bluesky AppView via PDS proxy.
          startTime(c, "get_profile_session");
          const client = await sessionLazy.value;
          endTime(c, "get_profile_session");
          if (!client) throw new Error("session_unavailable");
          startTime(c, "get_profile_network");
          try {
            const res = await client.get("app.bsky.actor.getProfile", {
              params: { actor: client.did as ActorIdentifier },
              headers: { "atproto-proxy": "did:web:api.bsky.app#bsky_appview" },
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

/**
 * Flush KOSync progress that was written optimistically to `user_book` but
 * could not yet be persisted to the user's PDS (KOSync requests carry no OAuth
 * session). Runs opportunistically whenever we do have a session agent, and
 * routes through the canonical `updateBookRecord` writer so PDS + DB stay
 * consistent with every other book update.
 */
async function flushPendingSyncWrites(client: SessionClient, ctx: BookUtilContext): Promise<void> {
  const key = `sync_pending:${client.did}`;
  try {
    const pending = await ctx.kv.getItem<PendingWrite[]>(key);
    if (!pending?.length) return;

    const failed: PendingWrite[] = [];
    for (const entry of pending) {
      try {
        // Only bridge books the user still tracks; never auto-create from a sync.
        const userBook = await ctx.db
          .selectFrom("user_book")
          .select(["uri"])
          .where("userDid", "=", client.did)
          .where("hiveId", "=", entry.hiveId as HiveId)
          .executeTakeFirst();
        if (!userBook) continue;

        await updateBookRecord({
          ctx,
          agent: client,
          hiveId: entry.hiveId as HiveId,
          updates: { bookProgress: JSON.parse(entry.bookProgress) },
        });
      } catch {
        failed.push(entry);
      }
    }

    if (failed.length > 0) {
      await ctx.kv.setItem(key, failed);
    } else {
      await ctx.kv.removeItem(key);
    }
  } catch {
    // fire-and-forget — don't break the login flow
  }
}
