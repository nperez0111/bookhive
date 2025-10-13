import { Agent } from "@atproto/api";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import type { OAuthClient } from "@atproto/oauth-client-node";
import { Firehose } from "@atproto/sync";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { prometheus } from "@hono/prometheus";
import { zValidator } from "@hono/zod-validator";

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
import { getSessionConfig } from "./auth/router";
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
import {
  getGoodreadsCsvParser,
  getStorygraphCsvParser,
  type GoodreadsBook,
  type StorygraphBook,
} from "./utils/csv.ts";
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
  const session = await getIronSession<Session>(req, res, getSessionConfig());

  if (!session.did) {
    return null;
  }

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did, false);
    // Use "auto" to automatically refresh tokens when needed
    await oauthSession.getTokenInfo("auto");
    // Keep session TTL fixed at 24 hours, independent of token expiration
    session.updateConfig(getSessionConfig());
    await session.save();
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
          const normalizeStr = (s: string) =>
            s?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
          const parser = getGoodreadsCsvParser();
          let id = 0;
          let totalBooks = 0;
          let matchedBooks = 0; // processed (matched to Hive)
          let uploadedBooks = 0; // newly created (not alreadyExists)
          const unmatchedBooks: GoodreadsBook[] = [];
          const unmatchedSet = new Set<string>();

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
          const existingHiveIdsPromise = bookRecords.then(
            (br) => new Set(Array.from(br.books.values()).map((b) => b.hiveId)),
          );

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
                    Partial<BookRecord.Record> & {
                      coverImage?: string;
                      alreadyExists?: boolean;
                    }
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
                              const key = `${normalizeStr(book.title)}::${normalizeStr(book.author)}`;
                              if (!unmatchedSet.has(key)) {
                                unmatchedSet.add(key);
                                unmatchedBooks.push(book);
                              }
                              return null;
                            }

                            const existingHiveIds =
                              await existingHiveIdsPromise;
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
                                alreadyExists: existingHiveIds.has(hiveBook.id),
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
                  const startProcessed = matchedBooks;
                  let idx = 0;
                  for (const book of bookUpdates.values()) {
                    const processed = startProcessed + ++idx;
                    await stream.writeSSE({
                      data: JSON.stringify({
                        title: book?.["title"],
                        author: book?.["authors"],
                        uploaded: 1,
                        processed,
                        failed: unmatchedBooks.length,
                        total: totalBooks,
                        event: "book-upload",
                        stage: "uploading",
                        stageProgress: {
                          current: processed,
                          total: totalBooks,
                          message: `Uploading books to your library (${processed}/${totalBooks})`,
                        },
                        // include the full book object for client rendering
                        book: book
                          ? {
                              hiveId: book["hiveId"],
                              title: book["title"],
                              authors: book["authors"],
                              coverImage: book["coverImage"],
                              status: book["status"],
                              finishedAt: book["finishedAt"],
                              stars: book["stars"],
                              review: book["review"],
                              alreadyExists: book["alreadyExists"],
                            }
                          : undefined,
                        id: id++,
                      }),
                    });
                    if (book && !(book as any)["alreadyExists"]) {
                      uploadedBooks++;
                    }
                  }

                  matchedBooks += bookUpdates.size;

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
                message: `Import complete! Successfully imported ${uploadedBooks} books${unmatchedBooks.length > 0 ? ` (${unmatchedBooks.length} failed)` : ""}`,
              },
              failedBooks: Array.from(
                new Map(
                  unmatchedBooks.map((b) => [
                    `${normalizeStr(b.title)}::${normalizeStr(b.author)}`,
                    { title: b.title, author: b.author },
                  ]),
                ).values(),
              ),
              // Send full failed book payloads so client can retry with minimal server state
              failedBookDetails: unmatchedBooks.map((b) => ({
                title: b.title,
                author: b.author,
                isbn10: b.isbn || undefined,
                isbn13: b.isbn13 || undefined,
                stars: b.myRating ? b.myRating * 2 : undefined,
                review: b.myReview || undefined,
                finishedAt: b.dateRead ? b.dateRead.toISOString() : undefined,
                status: b.dateRead ? "buzz.bookhive.defs#finished" : undefined,
              })),
              id: id++,
            }),
          });
        });
      },
    );

    // This is to import a StoryGraph CSV export
    // It is here because we don't want it behind the etag middleware
    app.post(
      "/import/storygraph",
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
          const normalizeStr = (s: string) =>
            s?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
          const parser = getStorygraphCsvParser();
          let id = 0;
          let totalBooks = 0;
          let matchedBooks = 0; // processed (matched to Hive)
          let uploadedBooks = 0; // newly created (not alreadyExists)
          const unmatchedBooks: StorygraphBook[] = [];
          const unmatchedSet = new Set<string>();

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
          const existingHiveIdsPromise = bookRecords.then(
            (br) => new Set(Array.from(br.books.values()).map((b) => b.hiveId)),
          );

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
                    Partial<BookRecord.Record> & {
                      coverImage?: string;
                      alreadyExists?: boolean;
                    }
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
                                author: book.authors,
                                processed: matchedBooks,
                                failed: unmatchedBooks.length,
                                failedBooks: unmatchedBooks.map((b) => ({
                                  title: b.title,
                                  author: b.authors,
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
                              // rawTitle is the title from the StoryGraph export
                              .where("hive_book.rawTitle", "=", book.title)
                              // authors is the author from the StoryGraph export
                              .where("authors", "=", book.authors)
                              .executeTakeFirst();

                            if (!hiveBook) {
                              const key = `${normalizeStr(book.title)}::${normalizeStr(book.authors)}`;
                              if (!unmatchedSet.has(key)) {
                                unmatchedSet.add(key);
                                unmatchedBooks.push(book);
                              }
                              return null;
                            }

                            // Map StoryGraph read status to BookHive status
                            let status = "buzz.bookhive.defs#wantToRead";
                            switch (book.readStatus.toLowerCase()) {
                              case "read":
                                status = "buzz.bookhive.defs#finished";
                                break;
                              case "currently-reading":
                                status = "buzz.bookhive.defs#reading";
                                break;
                              case "to-read":
                              default:
                                status = "buzz.bookhive.defs#wantToRead";
                                break;
                            }

                            const existingHiveIds =
                              await existingHiveIdsPromise;
                            // update the book record asynchronously
                            return [
                              hiveBook.id as HiveId,
                              {
                                authors: book.authors,
                                title: hiveBook.title,
                                status: status,
                                hiveId: hiveBook.id,
                                coverImage: hiveBook.cover ?? undefined,
                                finishedAt:
                                  book.lastDateRead?.toISOString() ?? undefined,
                                stars: book.starRating
                                  ? book.starRating * 2 // Convert 0-5 to 0-10 scale
                                  : undefined,
                                review: book.review || undefined,
                                alreadyExists: existingHiveIds.has(hiveBook.id),
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
                  const startProcessed = matchedBooks;
                  let idx = 0;
                  for (const book of bookUpdates.values()) {
                    const processed = startProcessed + ++idx;
                    await stream.writeSSE({
                      data: JSON.stringify({
                        title: book?.["title"],
                        author: book?.["authors"],
                        uploaded: 1,
                        processed,
                        failed: unmatchedBooks.length,
                        total: totalBooks,
                        event: "book-upload",
                        stage: "uploading",
                        stageProgress: {
                          current: processed,
                          total: totalBooks,
                          message: `Uploading books to your library (${processed}/${totalBooks})`,
                        },
                        book: book
                          ? {
                              hiveId: book["hiveId"],
                              title: book["title"],
                              authors: book["authors"],
                              coverImage: book["coverImage"],
                              status: book["status"],
                              finishedAt: book["finishedAt"],
                              stars: book["stars"],
                              review: book["review"],
                              alreadyExists: book["alreadyExists"],
                            }
                          : undefined,
                        id: id++,
                      }),
                    });
                    if (book && !(book as any)["alreadyExists"]) {
                      uploadedBooks++;
                    }
                  }

                  matchedBooks += bookUpdates.size;

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
                message: `Import complete! Successfully imported ${uploadedBooks} books${unmatchedBooks.length > 0 ? ` (${unmatchedBooks.length} failed)` : ""}`,
              },
              failedBooks: Array.from(
                new Map(
                  unmatchedBooks.map((b) => [
                    `${normalizeStr(b.title)}::${normalizeStr(b.authors)}`,
                    { title: b.title, author: b.authors },
                  ]),
                ).values(),
              ),
              failedBookDetails: unmatchedBooks.map((b) => ({
                title: b.title,
                author: b.authors,
                isbn13: b.isbn || undefined,
                stars: b.starRating ? b.starRating * 2 : undefined,
                review: b.review || undefined,
                finishedAt: b.lastDateRead
                  ? b.lastDateRead.toISOString()
                  : undefined,
                status:
                  b.readStatus?.toLowerCase() === "read"
                    ? "buzz.bookhive.defs#finished"
                    : b.readStatus?.toLowerCase() === "currently-reading"
                      ? "buzz.bookhive.defs#reading"
                      : undefined,
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

    app.use("/robots.txt", serveStatic({ root: "./public" }));

    // Sitemap
    app.get("/sitemap.xml", async (c) => {
      const baseUrl = new URL(c.req.url).origin;
      const currentDate = new Date().toISOString();

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/app</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy-policy</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`;

      return c.text(sitemap, 200, {
        "Content-Type": "application/xml",
      });
    });

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
