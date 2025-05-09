import { Agent } from "@atproto/api";
import type { OAuthClient } from "@atproto/oauth-client-node";
import { Firehose } from "@atproto/sync";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { pinoLogger, type Env } from "hono-pino";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { jsxRenderer } from "hono/jsx-renderer";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { getIronSession } from "iron-session";
import { pino } from "pino";
import { createStorage, type Storage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

import { createClient } from "./auth/client";
import {
  createBidirectionalResolver,
  createIdResolver,
  type BidirectionalResolver,
} from "./bsky/id-resolver";
import { createIngester } from "./bsky/ingester";
import type { Database } from "./db";
import { createDb, migrateToLatest } from "./db";
import { env } from "./env";
import { createRouter } from "./routes.tsx";
import sqliteKv from "./sqlite-kv.ts";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { readThroughCache } from "./utils/readThroughCache.ts";
import { lazy } from "./utils/lazy.ts";
import { instrument, opentelemetryMiddleware } from "./middleware/index.ts";
import { getLogger } from "./logger/index.ts";
import { differenceInSeconds } from "date-fns";

// Application state passed to the router and elsewhere
export type AppContext = {
  db: Database;
  kv: Storage;
  ingester: Firehose;
  logger: pino.Logger;
  oauthClient: OAuthClient;
  resolver: BidirectionalResolver;
  baseIdResolver: ReturnType<typeof createIdResolver>;
  getSessionAgent: () => Promise<Agent | null>;
  getProfile: () => Promise<ProfileViewDetailed | null>;
};

declare module "hono" {
  interface ContextVariableMap {
    ctx: AppContext;
  }
}

export type HonoServer = Hono<{
  Variables: {
    ctx: AppContext;
  } & Env["Variables"];
}>;

export type Session = { did: string };

// Helper function to get the Atproto Agent for the active session
export async function getSessionAgent(
  req: Request,
  res: Response,
  ctx: AppContext,
) {
  const session = await getIronSession<Session>(req, res, {
    cookieName: "sid",
    password: env.COOKIE_SECRET,
  });

  if (!session.did) {
    return null;
  }

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did, false);
    const tokenInfo = await oauthSession.getTokenInfo("auto");
    if (tokenInfo && tokenInfo.expiresAt) {
      session.updateConfig({
        cookieName: "sid",
        password: env.COOKIE_SECRET,
        ttl: differenceInSeconds(tokenInfo.expiresAt, new Date()),
      });
      await session.save();
    }
    return oauthSession ? new Agent(oauthSession) : null;
  } catch (err) {
    ctx.logger.warn({ err }, "oauth restore failed");
    await session.destroy();
    return null;
  }
}

export class Server {
  constructor(
    public app: HonoServer,
    public server: ServerType,
    public logger: pino.Logger,
  ) {}

  static async create() {
    const logger = getLogger({
      name: "server",

      redact: {
        paths: ["req.headers.cookie"],
        censor: "***REDACTED***",
      },
    });

    // Set up the SQLite database
    const db = createDb(env.DB_PATH);
    await migrateToLatest(db);

    const kv = createStorage({
      driver: sqliteKv({ location: env.KV_DB_PATH, table: "kv" }),
    });

    if (env.isProd) {
      // Not sure that we should store the search cache, so LRU is fine
      kv.mount("search:", lruCacheDriver({ max: 1000 }));
    }
    kv.mount(
      "profile:",
      sqliteKv({ location: env.KV_DB_PATH, table: "profile" }),
    );
    kv.mount(
      "didCache:",
      sqliteKv({ location: env.KV_DB_PATH, table: "didCache" }),
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
    // Don't care to store the book lock, so LRU is fine
    kv.mount("book_lock:", lruCacheDriver({ max: 1000 }));

    // Create the atproto utilities
    const oauthClient = await createClient(kv);
    const baseIdResolver = createIdResolver(kv);
    const ingester = createIngester(db, baseIdResolver);
    const resolver = createBidirectionalResolver(baseIdResolver);

    const time = new Date().toISOString();

    // Subscribe to events on the firehose
    ingester.start();

    // Create Hono app
    const app = new Hono<{
      Variables: {
        ctx: AppContext;
      } & Env["Variables"];
    }>();

    app.use(requestId());
    app.use(timing());
    if (env.isDevelopment) {
      app.use(prettyJSON());
    }
    app.use(
      pinoLogger({
        pino: logger,
        http: {
          onResLevel(c) {
            return c.req.path === "/healthcheck" ||
              c.req.path.startsWith("/public") ||
              c.req.path.startsWith("/images")
              ? "trace"
              : "info";
          },
        },
      }),
    );
    app.use(secureHeaders());
    app.use(compress());
    app.use(etag());
    app.use(jsxRenderer());

    // Add context to Hono app
    app.use("*", async (c, next) => {
      c.set("ctx", {
        db,
        ingester,
        logger,
        oauthClient,
        resolver,
        baseIdResolver,
        kv,
        getSessionAgent(): Promise<Agent | null> {
          return lazy(() =>
            getSessionAgent(c.req.raw, c.res, this).then((agent) => {
              if (agent) {
                c.var.logger.assign({ userDid: agent.did });
              }
              return agent;
            }),
          ).value;
        },
        async getProfile(): Promise<ProfileViewDetailed | null> {
          return lazy(async () => {
            const agent = await getSessionAgent(c.req.raw, c.res, this);
            if (!agent || !agent.did) {
              return Promise.resolve(null);
            }
            return readThroughCache(kv, "profile:" + agent.did, async () => {
              return agent
                .getProfile({
                  actor: agent.assertDid,
                })
                .then((res) => res.data);
            });
          }).value;
        },
      });
      await next();
    });
    app.use(opentelemetryMiddleware());

    app.get("/healthcheck", (c) => c.text(time));

    const { printMetrics, registerMetrics } = prometheus();
    app.use("*", registerMetrics);
    app.get("/metrics", printMetrics);

    // Routes
    createRouter(app);

    app.use(
      "/public/*",
      serveStatic({
        root: "./",
        rewriteRequestPath: (path) => path.replace(/^\/static/, "./public"),
      }),
    );

    // 404 handler
    app.notFound((c) => c.json({ message: "Not Found" }, 404));

    // Bind our server to the port
    const server = serve(
      {
        fetch: instrument(app).fetch,
        port: env.PORT,
      },
      ({ port }) => {
        logger.info(
          `Server (${env.NODE_ENV}) running on port http://localhost:${port}`,
        );
      },
    );

    return new Server(app, server, logger);
  }

  async close() {
    this.logger.info("sigint received, shutting down");
    return new Promise<void>((resolve) => {
      this.server.close(() => {
        this.logger.info("server closed");
        resolve();
      });
    });
  }
}

const run = async () => {
  const server = await Server.create();

  const onCloseSignal = async () => {
    setTimeout(() => process.exit(1), 10000).unref(); // Force shutdown after 10s
    await server.close();
    process.exit();
  };

  process.on("SIGINT", onCloseSignal);
  process.on("SIGTERM", onCloseSignal);
};

run();
