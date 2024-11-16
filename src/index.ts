import type { OAuthClient } from "@atproto/oauth-client-node";
import { Firehose } from "@atproto/sync";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { pino } from "pino";

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

// Application state passed to the router and elsewhere
export type AppContext = {
  db: Database;
  ingester: Firehose;
  logger: pino.Logger;
  oauthClient: OAuthClient;
  resolver: BidirectionalResolver;
};

export class Server {
  constructor(
    public app: Hono,
    public server: ServerType,
    public ctx: AppContext,
  ) {}

  static async create() {
    const { NODE_ENV, HOST, PORT, DB_PATH } = env;
    const logger = pino({ name: "server start" });

    // Set up the SQLite database
    const db = createDb(DB_PATH);
    await migrateToLatest(db);

    // Create the atproto utilities
    const oauthClient = await createClient(db);
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
    };

    // Subscribe to events on the firehose
    ingester.start();

    // Create Hono app
    const app = new Hono();

    app.use(prettyJSON());

    // Add context to Hono app
    app.use("*", async (c, next) => {
      // @ts-ignore
      c.set("ctx", ctx);
      await next();
    });

    // Routes
    createRouter(ctx, app);

    app.get("/ping", (c) => c.text("pong"));

    app.get("/healthcheck", (c) => c.text(time));

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
          `Server (${NODE_ENV}) running on port http://${HOST}:${port}`,
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
