import { Agent } from "@atproto/api";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import type { OAuthClient } from "@atproto/oauth-client-node";
import { Firehose } from "@atproto/sync";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { prometheus } from "@hono/prometheus";
import { zValidator } from "@hono/zod-validator";
import { differenceInSeconds } from "date-fns";
import { Hono } from "hono";
import { pinoLogger, type Env } from "hono-pino";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { jsxRenderer } from "hono/jsx-renderer";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { timing } from "hono/timing";
import { getIronSession } from "iron-session";
import { pino } from "pino";
import { createStorage, type Storage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";
import { z } from "zod";

import { createClient } from "./auth/client";
import {
  createBidirectionalResolver,
  createIdResolver,
  type BidirectionalResolver,
} from "./bsky/id-resolver";
import { createIngester } from "./bsky/ingester";
import * as BookRecord from "./bsky/lexicon/types/buzz/bookhive/book";
import type { Database } from "./db";
import { createDb, migrateToLatest } from "./db";
import { env } from "./env";
import { getLogger } from "./logger/index.ts";
import { instrument, opentelemetryMiddleware } from "./middleware/index.ts";
import { createRouter, searchBooks } from "./routes.tsx";
import sqliteKv from "./sqlite-kv.ts";
import type { HiveId } from "./types.ts";
import { createBatchTransform } from "./utils/batchTransform.ts";
import { getGoodreadsCsvParser, type GoodreadsBook } from "./utils/csv.ts";
import { getUserRepoRecords, updateBookRecords } from "./utils/getBook.ts";
import { lazy } from "./utils/lazy.ts";
import { readThroughCache } from "./utils/readThroughCache.ts";

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
    const ingester = createIngester(db, baseIdResolver, kv);
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

    // This is to import a Goodreads CSV export
    // It is here because we don't want it behind the etag middleware
    app.post(
      "/import/goodreads",
      zValidator(
        "form",
        z.object({
          export: z.instanceof(File),
        }),
      ),
      async (c) => {
        const ctx = c.get("ctx");
        const agent = await ctx.getSessionAgent();
        if (!agent) {
          return c.json(
            {
              success: false,
              error: "Invalid Session",
            },
            401,
          );
        }

        const { export: exportFile } = c.req.valid("form");
        return streamSSE(c, async (stream) => {
          const parser = getGoodreadsCsvParser();
          let id = 0;
          let totalBooks = 0;
          let matchedBooks = 0;
          const unmatchedBooks: GoodreadsBook[] = [];

          // Send initial event
          await stream.writeSSE({
            data: JSON.stringify({
              event: "import-start",
              stage: "initializing",
              stageProgress: {
                message: "Starting import process...",
              },
              id: id++,
            }),
          });

          // Create a stream pipeline
          const [countStream, uploadStream] = exportFile
            .stream()
            .pipeThrough(parser)
            .tee();

          // count the total number of books in a separate stream
          countStream.pipeTo(
            new WritableStream({
              async write(book) {
                // search asynchronously, already has a rate-limit in place
                searchBooks({ query: book.title, ctx });

                totalBooks++;
              },
            }),
          );

          const bookRecords = getUserRepoRecords({
            ctx,
            agent,
          });

          // Send event before starting uploads
          await stream.writeSSE({
            data: JSON.stringify({
              event: "upload-start",
              stage: "uploading",
              stageProgress: {
                current: 0,
                total: totalBooks,
                message: "Starting to upload books to your library...",
              },
              id: id++,
            }),
          });

          await uploadStream
            .pipeThrough(
              createBatchTransform(
                25,
                async (
                  books,
                ): Promise<
                  Map<
                    HiveId,
                    Partial<BookRecord.Record> & { coverImage?: string }
                  >
                > => {
                  return new Map(
                    (
                      await Promise.all(
                        books.map(async (book) => {
                          try {
                            await stream.writeSSE({
                              data: JSON.stringify({
                                title: book.title,
                                author: book.author,
                                processed: matchedBooks,
                                failed: unmatchedBooks.length,
                                failedBooks: unmatchedBooks.map((b) => ({
                                  title: b.title,
                                  author: b.author,
                                })),
                                total: totalBooks,
                                event: "book-load",
                                stage: "searching",
                                stageProgress: {
                                  current: totalBooks,
                                  total: "unknown",
                                  message: "Searching for books in Hive...",
                                },
                                id: id++,
                              }),
                            });
                            // Double-check that the book exists in Hive
                            // Multiple calls get de-duped
                            await searchBooks({ query: book.title, ctx });
                            let hiveBook = await ctx.db
                              .selectFrom("hive_book")
                              .select("id")
                              .select("title")
                              .select("cover")
                              // rawTitle is the title from the Goodreads export
                              .where("hive_book.rawTitle", "=", book.title)
                              // authors is the author from the Goodreads export
                              .where("authors", "=", book.author)
                              .executeTakeFirst();

                            if (!hiveBook) {
                              unmatchedBooks.push(book);
                              return null;
                            }

                            // update the book record asynchronously
                            return [
                              hiveBook.id as HiveId,
                              {
                                authors: book.author,
                                title: hiveBook.title,
                                // TODO there is probably something better
                                // Like make this idempotent
                                status: book.dateRead
                                  ? "buzz.bookhive.defs#finished"
                                  : "buzz.bookhive.defs#wantToRead",
                                hiveId: hiveBook.id,
                                coverImage: hiveBook.cover ?? undefined,
                                finishedAt:
                                  book.dateRead?.toISOString() ?? undefined,
                                stars: book.myRating
                                  ? book.myRating * 2
                                  : undefined,
                                review: book.myReview ?? undefined,
                              },
                            ] as const;
                          } catch (e) {
                            ctx.logger.error("Failed to update book record", {
                              error: e,
                              book,
                            });
                            unmatchedBooks.push(book);
                            return null;
                          }
                        }),
                      )
                    ).filter((a) => a !== null),
                  );
                },
              ),
            )
            .pipeTo(
              new WritableStream({
                async write(bookUpdates) {
                  matchedBooks += bookUpdates.size;
                  // Only send one book at a time to the client
                  const book = bookUpdates.values().next().value;

                  await stream.writeSSE({
                    data: JSON.stringify({
                      title: book?.["title"],
                      author: book?.["authors"],
                      uploaded: bookUpdates.size,
                      processed: matchedBooks,
                      failed: unmatchedBooks.length,
                      failedBooks: unmatchedBooks.map((b) => ({
                        title: b.title,
                        author: b.author,
                      })),
                      total: totalBooks,
                      event: "book-upload",
                      stage: "uploading",
                      stageProgress: {
                        current: matchedBooks,
                        total: totalBooks,
                        message: `Uploading books to your library (${matchedBooks}/${totalBooks})`,
                      },
                      id: id++,
                    }),
                  });

                  await updateBookRecords({
                    ctx,
                    agent,
                    updates: bookUpdates,
                    // overwrite: true,
                    bookRecords,
                  });
                },
              }),
            );

          // Send final completion event
          await stream.writeSSE({
            data: JSON.stringify({
              event: "import-complete",
              stage: "complete",
              stageProgress: {
                current: matchedBooks,
                total: totalBooks,
                message: `Import complete! Successfully imported ${matchedBooks} books${unmatchedBooks.length > 0 ? ` (${unmatchedBooks.length} failed)` : ""}`,
              },
              failedBooks: unmatchedBooks.map((b) => ({
                title: b.title,
                author: b.author,
              })),
              id: id++,
            }),
          });
        });
      },
    );

    // TODO enable etag for everything but import route
    app.use(etag());
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
