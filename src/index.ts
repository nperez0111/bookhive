import type { OAuthClient } from "@atproto/oauth-client-node";
import { Firehose } from "@atproto/sync";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { compress } from "hono/compress";
import { jsxRenderer } from "hono/jsx-renderer";
import { etag } from "hono/etag";
import { secureHeaders } from "hono/secure-headers";
import { pino } from "pino";
import { pinoLogger } from "hono-pino";
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
import { getIronSession } from "iron-session";
import { Agent } from "@atproto/api";

// Application state passed to the router and elsewhere
export type AppContext = {
  db: Database;
  kv: Storage;
  ingester: Firehose;
  logger: pino.Logger;
  oauthClient: OAuthClient;
  resolver: BidirectionalResolver;
  baseIdResolver: ReturnType<typeof createIdResolver>;
  getSessionAgent: (req: Request, res: Response) => Promise<Agent | null>;
};

declare module "hono" {
  interface ContextVariableMap {
    ctx: AppContext;
  }
}

export type HonoServer = Hono<{
  Variables: {
    ctx: AppContext;
  };
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
    const oauthSession = await ctx.oauthClient.restore(session.did);
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
    public ctx: AppContext,
  ) {}

  static async create() {
    const { NODE_ENV, PORT, DB_PATH, LOG_LEVEL, KV_DB_PATH } = env;
    const logger = pino({ name: "server", level: LOG_LEVEL });

    // Set up the SQLite database
    const db = createDb(DB_PATH);
    await migrateToLatest(db);

    const kv = createStorage({
      driver: sqliteKv({ location: KV_DB_PATH }),
    });

    if (env.isProd) {
      // Not sure that we should store the search cache, so LRU is fine
      kv.mount("search:", lruCacheDriver({ max: 1000 }));
    }
    kv.mount("book:", sqliteKv({ location: DB_PATH, table: "book_hive" }));
    kv.mount("profile:", sqliteKv({ location: KV_DB_PATH, table: "profile" }));
    kv.mount(
      "auth_session:",
      sqliteKv({ location: KV_DB_PATH, table: "auth_sessions" }),
    );
    kv.mount(
      "auth_state:",
      sqliteKv({ location: KV_DB_PATH, table: "auth_state" }),
    );

    // Create the atproto utilities
    const oauthClient = await createClient(kv);
    const baseIdResolver = createIdResolver();
    const ingester = createIngester(db, baseIdResolver);
    const resolver = createBidirectionalResolver(baseIdResolver);

    const time = new Date().toISOString();
    const ctx = {
      db,
      ingester,
      logger,
      oauthClient,
      resolver,
      baseIdResolver,
      kv,
      getSessionAgent: (req: Request, res: Response): Promise<Agent | null> =>
        getSessionAgent(req, res, ctx),
    } satisfies AppContext;

    // Subscribe to events on the firehose
    ingester.start();

    // Create Hono app
    const app = new Hono() as HonoServer;

    app.use(requestId());
    if (env.isDevelopment) {
      app.use(prettyJSON());
    }
    app.use(
      pinoLogger({
        pino: logger,
        http: {
          onResLevel(c) {
            return c.req.path === "/healthcheck" ? "trace" : "info";
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
      c.set("ctx", ctx);
      await next();
    });

    app.get("/healthcheck", (c) => c.text(time));

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
        fetch: app.fetch,
        port: PORT,
      },
      ({ port }) => {
        logger.info(
          `Server (${NODE_ENV}) running on port http://localhost:${port}`,
        );
      },
    );

    return new Server(app, server, ctx);
  }

  async close() {
    this.ctx.logger.info("sigint received, shutting down");
    await this.ctx.ingester.destroy();
    return new Promise<void>((resolve) => {
      this.server.close(() => {
        this.ctx.logger.info("server closed");
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
