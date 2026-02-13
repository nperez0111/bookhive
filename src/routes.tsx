import { Agent, isDid } from "@atproto/api";
import { TID } from "@atproto/common";
import { zValidator } from "@hono/zod-validator";
import { methodOverride } from "hono/method-override";

import { Fragment } from "hono/jsx";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { z } from "zod";

import {
  createIPX,
  createIPXWebServer,
  ipxFSStorage,
  ipxHttpStorage,
} from "ipx";
import { sql, type NotNull } from "kysely";
import type { AppContext, HonoServer } from ".";
import { loginRouter } from "./auth/router";
import { ids } from "./bsky/lexicon/lexicons";
import * as BookRecord from "./bsky/lexicon/types/buzz/bookhive/book";
import * as BuzzRecord from "./bsky/lexicon/types/buzz/bookhive/buzz";
import type * as GetBook from "./bsky/lexicon/types/buzz/bookhive/getBook";
import type * as GetBookIdMap from "./bsky/lexicon/types/buzz/bookhive/getBookIdMap";
import type * as GetProfile from "./bsky/lexicon/types/buzz/bookhive/getProfile";
import { validateMain } from "./bsky/lexicon/types/com/atproto/repo/strongRef";
import { BOOK_STATUS, BOOK_STATUS_MAP } from "./constants";
import { BookFields } from "./db";
import { BookInfo } from "./pages/bookInfo";
import { CommentsSection } from "./pages/comments";
import { Error as ErrorPage } from "./pages/error";
import { Home } from "./pages/home";
import { AppPage } from "./pages/app";
import { Layout } from "./pages/layout";
import { Navbar } from "./pages/navbar";
import { ProfilePage } from "./pages/profile";
import { PrivacyPolicy } from "./pages/privacy-policy";
import { findBookDetails } from "./scrapers";
import { type BookProgress, type HiveBook, type HiveId } from "./types";
import { updateBookRecord } from "./utils/getBook";
import { syncUserFollows, shouldSyncFollows } from "./utils/getFollows";
import { getProfile } from "./utils/getProfile";
import { readThroughCache } from "./utils/readThroughCache";
import { LibraryImport } from "./pages/import";
import { enrichBookWithDetailedData } from "./utils/enrichBookData";
import { GenresDirectory } from "./pages/genres";
import { GenreBooks, getBooksByGenre } from "./pages/genreBooks";
import { hydrateUserBook, serializeUserBook } from "./utils/bookProgress";
import {
  deriveBookIdMap,
  normalizeGoodreadsId,
  normalizeHiveId,
  normalizeIsbn,
  normalizeIsbn13,
  toBookIdMapOutput,
  upsertBookIdMap,
  upsertBookIdMaps,
} from "./utils/bookIdMap";

declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title?: string; image?: string; description?: string },
    ): Response;
  }
}

const ipx = createIPXWebServer(
  createIPX({
    maxAge: 60 * 60 * 24 * 30,
    storage: ipxFSStorage({ dir: "./public" }),
    httpStorage: ipxHttpStorage({
      domains: ["i.gr-assets.com", "cdn.bsky.app"],
      ignoreCacheControl: true,
      maxAge: 60 * 60 * 24 * 30,
    }),
  }),
);

export async function searchBooks({
  query,
  ctx,
}: {
  query: string;
  ctx: Pick<AppContext, "db" | "kv" | "logger">;
}) {
  return await readThroughCache<HiveId[]>(
    ctx.kv,
    `search:${query}`,
    () =>
      findBookDetails(query).then(async (res) => {
        if (!res.success) {
          return [];
        }

        const bookIds = await ctx.db
          .insertInto("hive_book")
          .values(res.data)
          .onConflict((oc) =>
            oc.column("id").doUpdateSet((c) => {
              return {
                rating: c.ref("excluded.rating"),
                ratingsCount: c.ref("excluded.ratingsCount"),
                updatedAt: c.ref("excluded.updatedAt"),
                rawTitle: c.ref("excluded.rawTitle"),
              };
            }),
          )
          .execute()
          .then(() => {
            return res.data.map((book) => book.id);
          });

        try {
          await upsertBookIdMaps(ctx.db, res.data);
        } catch (error) {
          ctx.logger.warn(
            {
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to persist book id mappings during search",
          );
        }

        // Trigger background enrichment for all books
        const enrichmentPromises = res.data.map((book) =>
          enrichBookWithDetailedData(book, ctx as AppContext).catch((error) => {
            ctx.logger.error(
              {
                bookId: book.id,
                error: error instanceof Error ? error.message : String(error),
              },
              "Background enrichment failed",
            );
          }),
        );

        // Fire and forget - don't await enrichment
        Promise.allSettled(enrichmentPromises);

        return bookIds;
      }),
    [] as HiveId[],
    {
      requestsPerSecond: 5,
    },
  );
}

async function findBookIdMapByLookup({
  ctx,
  hiveId,
  isbn,
  isbn13,
  goodreadsId,
}: {
  ctx: Pick<AppContext, "db">;
  hiveId: HiveId | null;
  isbn: string | null;
  isbn13: string | null;
  goodreadsId: string | null;
}) {
  let query = ctx.db.selectFrom("book_id_map").selectAll();

  if (hiveId) {
    query = query.where("hiveId", "=", hiveId);
  }
  if (isbn) {
    query = query.where("isbn", "=", isbn);
  }
  if (isbn13) {
    query = query.where("isbn13", "=", isbn13);
  }
  if (goodreadsId) {
    query = query.where("goodreadsId", "=", goodreadsId);
  }

  return query.executeTakeFirst();
}

async function findHiveBookByBookIdLookup({
  ctx,
  hiveId,
  isbn,
  isbn13,
  goodreadsId,
}: {
  ctx: Pick<AppContext, "db">;
  hiveId: HiveId | null;
  isbn: string | null;
  isbn13: string | null;
  goodreadsId: string | null;
}): Promise<HiveBook | undefined> {
  if (hiveId) {
    const byHiveId = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("id", "=", hiveId)
      .executeTakeFirst();
    if (byHiveId) {
      return byHiveId;
    }
  }

  if (goodreadsId) {
    const byGoodreadsId = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("source", "=", "Goodreads")
      .where((eb) =>
        eb.or([
          eb("sourceId", "=", goodreadsId),
          eb("sourceUrl", "like", `%/book/show/${goodreadsId}%`),
        ]),
      )
      .executeTakeFirst();
    if (byGoodreadsId) {
      return byGoodreadsId;
    }
  }

  if (isbn) {
    const byIsbn = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where(
        sql<
          string | null
        >`NULLIF(REPLACE(REPLACE(UPPER(CAST(json_extract(meta, '$.isbn') AS TEXT)), '-', ''), ' ', ''), '')`,
        "=",
        isbn,
      )
      .executeTakeFirst();
    if (byIsbn) {
      return byIsbn;
    }
  }

  if (isbn13) {
    const byIsbn13 = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where(
        sql<
          string | null
        >`NULLIF(REPLACE(REPLACE(CAST(json_extract(meta, '$.isbn13') AS TEXT), '-', ''), ' ', ''), '')`,
        "=",
        isbn13,
      )
      .executeTakeFirst();
    if (byIsbn13) {
      return byIsbn13;
    }
  }

  return undefined;
}

async function ensureBookIdMapCurrent({
  ctx,
  book,
}: {
  ctx: AppContext;
  book: HiveBook;
}): Promise<void> {
  let latestBook = book;

  if (!latestBook.enrichedAt) {
    await enrichBookWithDetailedData(latestBook, ctx);

    const refreshedBook = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("id", "=", latestBook.id)
      .executeTakeFirst();

    if (refreshedBook) {
      latestBook = refreshedBook;
    }
  }

  await upsertBookIdMap(ctx.db, latestBook);
}

async function syncFollowsIfNeeded({
  agent,
  ctx,
}: {
  agent: Agent;
  ctx: AppContext;
}) {
  if (!agent) {
    return;
  }

  try {
    const shouldSync = await shouldSyncFollows(ctx, agent.assertDid);
    if (shouldSync) {
      await syncUserFollows(ctx, agent);
      ctx.logger.info(
        { userDid: agent.assertDid },
        "Follows sync completed on login",
      );
    }
  } catch (error) {
    ctx.logger.warn(
      { userDid: agent.assertDid, error },
      "Failed to sync follows on login",
    );
  }
}

// TODO use getUserRepoRecords
async function refetchBuzzes({
  agent,
  ctx,
  cursor,
  uris = [],
}: {
  agent: Agent;
  ctx: AppContext;
  cursor?: string;
  uris?: string[];
}) {
  if (!agent) {
    return;
  }
  const buzzes = await agent.com.atproto.repo.listRecords({
    repo: agent.assertDid,
    collection: ids.BuzzBookhiveBuzz,
    limit: 100,
    cursor,
  });

  await buzzes.data.records
    .filter((record) => BuzzRecord.validateRecord(record.value).success)
    .reduce(async (acc, record) => {
      await acc;
      const book = record.value as BuzzRecord.Record;

      const hiveId = (
        await ctx.db
          .selectFrom("user_book")
          .select("hiveId")
          .where("uri", "=", book.book.uri)
          .executeTakeFirst()
      )?.hiveId;

      if (!hiveId) {
        ctx.logger.error({ record }, "hiveId not found for book");
        return;
      }

      uris.push(record.uri);

      await ctx.db
        .insertInto("buzz")
        .values({
          uri: record.uri,
          cid: record.cid,
          userDid: agent.assertDid,
          createdAt: book.createdAt,
          indexedAt: new Date().toISOString(),
          hiveId: hiveId,
          comment: book.comment,
          parentUri: book.parent.uri,
          parentCid: book.parent.cid,
          bookCid: book.book.cid,
          bookUri: book.book.uri,
        })
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet((c) => ({
            cid: c.ref("excluded.cid"),
            userDid: c.ref("excluded.userDid"),
            createdAt: c.ref("excluded.createdAt"),
            indexedAt: c.ref("excluded.indexedAt"),
            hiveId: c.ref("excluded.hiveId"),
            comment: c.ref("excluded.comment"),
            parentUri: c.ref("excluded.parentUri"),
            parentCid: c.ref("excluded.parentCid"),
            bookCid: c.ref("excluded.bookCid"),
            bookUri: c.ref("excluded.bookUri"),
          })),
        )
        .execute();
    }, Promise.resolve());

  // TODO optimize this
  if (buzzes.data.records.length === 100) {
    // Fetch next page, after a short delay
    await setTimeout(() => {}, 100);
    return refetchBuzzes({ agent, ctx, cursor: buzzes.data.cursor, uris });
  } else {
    // Clear buzzes which no longer exist
    await ctx.db
      .deleteFrom("buzz")
      .where("userDid", "=", agent.assertDid)
      .where("uri", "not in", uris)
      .execute();
  }
}
// TODO use getUserRepoRecords
async function refetchBooks({
  agent,
  ctx,
  cursor,
  uris = [],
}: {
  agent: Agent;
  ctx: AppContext;
  cursor?: string;
  uris?: string[];
}) {
  if (!agent) {
    return;
  }
  const bookRecordsRaw = await agent.com.atproto.repo.listRecords({
    repo: agent.assertDid,
    collection: ids.BuzzBookhiveBook,
    limit: 100,
    cursor,
  });
  const bookRecords = bookRecordsRaw.data.records
    .filter((record) => BookRecord.validateRecord(record.value).success)
    .map((r) => ({ ...r, value: r.value as BookRecord.Record }));

  // Group records by hiveId to find duplicates
  const duplicatesByHiveId = new Map<string, typeof bookRecords>();
  bookRecords.forEach((record) => {
    const hiveId = record.value.hiveId;
    if (hiveId) {
      if (!duplicatesByHiveId.has(hiveId)) {
        duplicatesByHiveId.set(hiveId, []);
      }
      duplicatesByHiveId.set(hiveId, [
        ...duplicatesByHiveId.get(hiveId)!,
        record,
      ]);
    }
  });

  const promises = [] as Promise<any>[];

  // Delete duplicate records
  Array.from(duplicatesByHiveId.values()).map(async (records) => {
    if (records.length > 1) {
      ctx.logger.info({ records }, "Duplicate book found");
      const [_recordToKeep, ...recordsToDelete] = records.sort((a, b) =>
        a.value.createdAt.localeCompare(b.value.createdAt),
      );

      recordsToDelete.forEach(async (r) => {
        const rkey = r.uri.split("/").pop()!;
        promises.push(
          agent.com.atproto.repo.deleteRecord({
            repo: agent.assertDid,
            collection: ids.BuzzBookhiveBook,
            rkey,
          }),
        );
        promises.push(
          ctx.db
            .deleteFrom("user_book")
            .where("uri", "=", r.uri)
            .where("userDid", "=", agent.assertDid)
            .execute(),
        );
      });
    }
  });

  await bookRecords.reduce(async (acc, record) => {
    await acc;
    const book = record.value;

    promises.push(searchBooks({ query: book.title, ctx }));

    uris.push(record.uri);

    await ctx.db
      .insertInto("user_book")
      .values(
        serializeUserBook({
          uri: record.uri,
          cid: record.cid,
          userDid: agent.assertDid,
          createdAt: book.createdAt,
          title: book.title,
          authors: book.authors,
          indexedAt: new Date().toISOString(),
          hiveId: book.hiveId as HiveId,
          status: book.status,
          startedAt: book.startedAt,
          finishedAt: book.finishedAt,
          review: book.review,
          stars: book.stars,
          bookProgress: book.bookProgress ?? null,
        }),
      )
      .onConflict((oc) =>
        oc.column("uri").doUpdateSet((c) => ({
          cid: c.ref("excluded.cid"),
          userDid: c.ref("excluded.userDid"),
          createdAt: c.ref("excluded.createdAt"),
          indexedAt: c.ref("excluded.indexedAt"),
          title: c.ref("excluded.title"),
          authors: c.ref("excluded.authors"),
          status: c.ref("excluded.status"),
          startedAt: c.ref("excluded.startedAt"),
          finishedAt: c.ref("excluded.finishedAt"),
          hiveId: c.ref("excluded.hiveId"),
          review: c.ref("excluded.review"),
          stars: c.ref("excluded.stars"),
          bookProgress: c.ref("excluded.bookProgress"),
        })),
      )
      .execute();
  }, Promise.resolve());

  await Promise.all(promises);
  // TODO optimize this
  if (bookRecordsRaw.data.records.length === 100) {
    // Fetch next page, after a short delay
    await setTimeout(() => {}, 10);
    return refetchBooks({
      agent,
      ctx,
      cursor: bookRecordsRaw.data.cursor,
      uris,
    });
  } else {
    // Clear books which no longer exist
    await ctx.db
      .deleteFrom("user_book")
      .where("userDid", "=", agent.assertDid)
      .where("uri", "not in", uris)
      .execute();
  }
}

export function createRouter(app: HonoServer) {
  loginRouter(app, {
    onLogin: async ({ agent, ctx }) => {
      if (!agent) {
        return;
      }

      // Fetch books/buzzes and sync follows on login, but don't wait for it
      await Promise.race([
        Promise.all([
          refetchBooks({ agent, ctx }).then(() =>
            refetchBuzzes({ agent, ctx }),
          ),
          syncFollowsIfNeeded({ agent, ctx }),
        ]),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    },
  });

  app.use(
    jsxRenderer(async ({ children, Layout: _Layout, ...props }) => {
      const c = useRequestContext();
      const profile = await c.get("ctx").getProfile();

      return (
        <Layout {...props}>
          <Navbar profile={profile} />
          <div class="relative">{children}</div>
        </Layout>
      );
    }),
  );

  app.use("/images/*", (c) => {
    return ipx(new Request(c.req.raw.url.replace(/\/images/, "")));
  });

  // Homepage
  app.get("/", async (c) => {
    const url = new URL(c.req.raw.url);
    if (url.searchParams.get("app") || url.hostname === "app.bookhive.buzz") {
      return c.redirect("/app");
    }

    return c.render(<Home />, {
      title: "BookHive | Home",
    });
  });

  app.get("/.well-known/atproto-did", async (c) => {
    return c.text("did:plc:enu2j5xjlqsjaylv3du4myh4");
  });

  app.get("/refresh-books", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to refresh books"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    await refetchBooks({
      agent,
      ctx: c.get("ctx"),
    });

    if (c.req.header()["accept"] === "application/json") {
      const books = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .selectAll()
        .where("userDid", "=", agent.assertDid)
        .orderBy("indexedAt", "desc")
        .limit(10)
        .execute();

      return c.json(books);
    }

    return c.redirect("/");
  });

  // Redirect to profile/:handle
  app.get("/profile", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to view your profile"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    const handle = await c
      .get("ctx")
      .resolver.resolveDidToHandle(agent.assertDid);

    return c.redirect(`/profile/${handle}`);
  });

  // Redirect to profile/:handle
  app.get("/import", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to view your profile"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    return c.render(<LibraryImport />, {
      title: "BookHive | Import",
      description:
        "Import your library from Goodreads or StoryGraph to BookHive",
    });
  });

  app.get("/app", async (c) => {
    return c.render(<AppPage />, {
      title: "BookHive App for iOS",
      description:
        "The BookHive iOS app lets you manage, organize, and review your books anywhere.",
      image: "/public/hive.jpg",
    });
  });

  app.get("/privacy-policy", async (c) => {
    return c.render(<PrivacyPolicy />, {
      title: "BookHive | Privacy Policy",
      description:
        "Learn how BookHive uses cookies for login and only processes public ATProto data.",
    });
  });

  app.get("/genres", async (c) => {
    return c.render(<GenresDirectory />, {
      title: "BookHive | Explore Genres",
      description: "Explore books by genre on BookHive",
    });
  });

  app.get("/genres/:genre", async (c) => {
    const genre = decodeURIComponent(c.req.param("genre"));
    const page = parseInt(c.req.query("page") || "1", 10);
    const sortBy =
      (c.req.query("sort") as "popularity" | "relevance" | "reviews") ||
      "popularity";
    const pageSize = 100;

    // Validate page number
    const validPage = Math.max(1, page);

    const result = await getBooksByGenre(
      genre,
      c.get("ctx"),
      validPage,
      pageSize,
      sortBy,
      c,
    );

    return c.render(
      <GenreBooks
        genre={genre}
        books={result.books}
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        totalBooks={result.totalBooks}
        sortBy={sortBy}
      />,
      {
        title: `BookHive | ${genre} Books`,
        description: `Discover ${genre} books on BookHive`,
      },
    );
  });

  app.get("/profile/:handle/image", async (c) => {
    const handle = c.req.param("handle");

    const did = isDid(handle)
      ? handle
      : await c.get("ctx").baseIdResolver.handle.resolve(handle);

    const profile = await getProfile({ ctx: c.get("ctx"), did: did! });

    if (!profile || !profile.avatar) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Profile not found"
            description="The profile you are looking for does not exist"
            statusCode={404}
          />
        </Layout>,
        404,
      );
    }

    return c.redirect(`/images/w_500/${profile.avatar}`);
  });

  app.get("/profile/:handle", async (c) => {
    const handle = c.req.param("handle");

    const did = isDid(handle)
      ? handle
      : await c.get("ctx").baseIdResolver.handle.resolve(handle);

    if (!did) {
      return c.render(
        <Fragment>
          <h1>Profile {handle} not found</h1>
          <p>
            This profile may not exist or has not logged any books on bookhive
          </p>
        </Fragment>,
        { title: "Profile Not Found" },
      );
    }

    const isBuzzer = Boolean(
      await c
        .get("ctx")
        .db.selectFrom("user_book")
        .select("userDid")
        .where("userDid", "=", did)
        .limit(1)
        .executeTakeFirst(),
    );

    const profile = await getProfile({ ctx: c.get("ctx"), did });
    const books = isBuzzer
      ? await c
          .get("ctx")
          .db.selectFrom("user_book")
          .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
          .select(BookFields)
          .where("user_book.userDid", "=", did)
          .orderBy("user_book.indexedAt", "desc")
          .limit(10_000)
          .execute()
      : [];
    const parsedBooks = books.map((book) => hydrateUserBook(book));

    const sessionAgent = await c.get("ctx").getSessionAgent();
    const isFollowing =
      sessionAgent && sessionAgent.assertDid !== did
        ? Boolean(
            await c
              .get("ctx")
              .db.selectFrom("user_follows")
              .select(["followsDid"]) // lightweight
              .where("userDid", "=", sessionAgent.assertDid)
              .where("followsDid", "=", did)
              .where("isActive", "=", 1)
              .executeTakeFirst(),
          )
        : undefined;

    return c.render(
      <ProfilePage
        isBuzzer={isBuzzer}
        handle={handle}
        did={did}
        books={parsedBooks}
        profile={profile}
        isFollowing={isFollowing}
        canFollow={Boolean(sessionAgent) && sessionAgent?.assertDid !== did}
        isOwnProfile={sessionAgent?.assertDid === did}
      />,
      {
        title: "BookHive | @" + handle,
        description: `@${handle}'s BookHive Profile page with ${parsedBooks.length} books`,
        image: profile?.avatar,
      },
    );
  });

  app.get("/books/:hiveId", async (c) => {
    const book = await c
      .get("ctx")
      .db.selectFrom("hive_book")
      .selectAll()
      .where("id", "=", c.req.param("hiveId") as HiveId)
      .limit(1)
      .executeTakeFirst();

    if (!book) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Book not found"
            description="The book you are looking for does not exist"
            statusCode={404}
          />
        </Layout>,
        404,
      );
    }

    // Trigger background enrichment if needed
    const needsEnrichment =
      !book.enrichedAt ||
      new Date(book.enrichedAt) <
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    if (needsEnrichment) {
      // Fire and forget - don't await
      enrichBookWithDetailedData(book, c.get("ctx")).catch((error) => {
        c.get("ctx").logger?.error(
          {
            bookId: book.id,
            error:
              error instanceof Error ? error.message : (String(error) as any),
          },
          "Background enrichment failed on book view",
        );
      });
    }

    return c.render(<BookInfo book={book} />, {
      title: "BookHive | " + book.title,
      image: `${new URL(c.req.url).origin}/images/s_1190x665,fit_contain,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
      description: `See ${book.title} by ${book.authors.split("\t").join(", ")} on BookHive, a Goodreads alternative built on Blue Sky`,
    });
  });

  app.use("/books/:hiveId", methodOverride({ app }));

  app.delete("/books/:hiveId", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to delete a book"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    const hiveId = c.req.param("hiveId") as HiveId;

    const book = await c
      .get("ctx")
      .db.selectFrom("user_book")
      .selectAll()
      .where("userDid", "=", agent.assertDid)
      .where("hiveId", "=", hiveId)
      .execute();

    if (book.length === 0) {
      return c.json({ success: false, hiveId, book: null });
    }
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: agent.assertDid,
        collection: ids.BuzzBookhiveBook,
        rkey: book[0].uri.split("/").at(-1)!,
      });

      await c
        .get("ctx")
        .db.deleteFrom("user_book")
        .where("userDid", "=", agent.assertDid)
        .where("uri", "=", book[0].uri)
        .execute();

      if (c.req.header()["accept"] === "application/json") {
        return c.json({ success: true, hiveId, book: book[0] });
      }

      // Check for redirect query parameter, default to book page
      const redirectTo = c.req.query("redirect") || `/books/${hiveId}`;
      return c.redirect(redirectTo);
    } catch (e) {
      console.error("Failed to delete book", e);
      throw e;
    }
  });

  app.post(
    "/books",
    zValidator(
      "form",
      z.object({
        authors: z.string(),
        title: z.string(),
        hiveId: z.string(),
        status: z.string().optional(),
        coverImage: z.string().optional(),
        startedAt: z.string().optional(),
        finishedAt: z.string().optional(),
        stars: z.coerce.number().optional(),
        review: z.string().optional(),
        percent: z.coerce.number().int().min(0).max(100).optional(),
        totalPages: z.preprocess(
          (val) => (val === "" ? undefined : val),
          z.coerce.number().int().min(1).optional(),
        ),
        currentPage: z.preprocess(
          (val) => (val === "" ? undefined : val),
          z.coerce.number().int().min(1).optional(),
        ),
        totalChapters: z.preprocess(
          (val) => (val === "" ? undefined : val),
          z.coerce.number().int().min(1).optional(),
        ),
        currentChapter: z.preprocess(
          (val) => (val === "" ? undefined : val),
          z.coerce.number().int().min(1).optional(),
        ),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Invalid Session"
              description="Login to add a book"
              statusCode={401}
            />
          </Layout>,
          401,
        );
      }
      const bookLockKey = "book_lock:" + agent.assertDid;
      try {
        const {
          authors,
          title,
          status,
          hiveId,
          coverImage,
          startedAt,
          finishedAt,
          stars,
          review,
          currentPage,
          totalPages,
          currentChapter,
          totalChapters,
          percent,
        } = await c.req.valid("form");

        let bookProgress;
        if (
          currentPage ||
          totalPages ||
          currentChapter ||
          totalChapters ||
          percent !== undefined
        ) {
          if (currentPage && totalPages && currentPage > totalPages) {
            throw new Error("Current page cannot exceed total pages");
          }
          if (
            currentChapter &&
            totalChapters &&
            currentChapter > totalChapters
          ) {
            throw new Error("Current chapter cannot exceed total chapters");
          }

          bookProgress = {
            percent: percent ?? undefined,
            totalPages: totalPages ?? undefined,
            currentPage: currentPage ?? undefined,
            totalChapters: totalChapters ?? undefined,
            currentChapter: currentChapter ?? undefined,
            updatedAt: new Date().toISOString(),
          };
        }

        const bookLock = await c.get("ctx").kv.get(bookLockKey);
        if (bookLock) {
          return c.html(
            <Layout>
              <ErrorPage
                message={`Book ${bookLock} already being added`}
                statusCode={429}
              />
            </Layout>,
            429,
          );
        }

        try {
          await c.get("ctx").kv.setItem(bookLockKey, hiveId);
          await updateBookRecord({
            ctx: c.get("ctx"),
            agent,
            hiveId: hiveId as HiveId,
            updates: {
              authors,
              title,
              status,
              hiveId,
              coverImage,
              startedAt,
              finishedAt,
              stars,
              review,
              ...(bookProgress ? { bookProgress } : {}),
            },
          });
        } catch (e) {
          return c.html(
            <Layout>
              <ErrorPage
                message="Failed to record book"
                description={"Error: " + (e as Error).message}
                statusCode={500}
              />
            </Layout>,
            500,
          );
        } finally {
          await c.get("ctx").kv.del(bookLockKey);
        }
        return c.redirect("/books/" + hiveId);
      } catch (err) {
        c.get("ctx").logger.warn({ err }, "failed to write book");
        await c.get("ctx").kv.del(bookLockKey);
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to record book"
              description={"Error: " + (err as Error).message}
              statusCode={500}
            />
          </Layout>,
          500,
        );
      }
    },
  );

  app.post(
    "/comments",
    zValidator(
      "form",
      z.object({
        uri: z
          .string()
          .describe(
            "The URI of the comment to update. If this is not provided, a new comment will be created.",
          )
          .optional(),
        hiveId: z.string(),
        comment: z.string(),
        parentUri: z.string(),
        parentCid: z.string(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Invalid Session"
              description="Login to post a comment"
              statusCode={401}
            />
          </Layout>,
          401,
        );
      }

      const { hiveId, comment, parentUri, parentCid, uri } =
        await c.req.valid("form");

      const originalBuzz = uri
        ? await c
            .get("ctx")
            .db.selectFrom("buzz")
            .selectAll()
            .where("uri", "=", uri)
            .limit(1)
            .executeTakeFirst()
        : null;
      const book = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .select(["cid", "uri"])
        .where("hiveId", "=", hiveId as HiveId)
        .executeTakeFirst();
      const createdAt = originalBuzz?.createdAt || new Date().toISOString();

      const bookRef = validateMain({ uri: book?.uri, cid: book?.cid });
      const parentRef = validateMain({ uri: parentUri, cid: parentCid });
      if (!bookRef.success || !parentRef.success || !book || !bookRef.value) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Invalid Hive ID"
              description="The book you are looking for does not exist"
              statusCode={404}
            />
          </Layout>,
          404,
        );
      }

      const response = await agent.com.atproto.repo.applyWrites({
        repo: agent.assertDid,
        writes: [
          {
            $type: originalBuzz
              ? "com.atproto.repo.applyWrites#update"
              : "com.atproto.repo.applyWrites#create",
            collection: ids.BuzzBookhiveBuzz,
            rkey: originalBuzz
              ? originalBuzz.uri.split("/").at(-1)!
              : TID.nextStr(),
            value: {
              book: bookRef.value,
              comment,
              parent: parentRef.value,
              createdAt,
            },
          },
        ],
      });

      const firstResult = response.data.results?.[0];
      if (
        !response.success ||
        !response.data.results ||
        response.data.results.length === 0 ||
        !firstResult ||
        !(
          firstResult.$type === "com.atproto.repo.applyWrites#createResult" ||
          firstResult.$type === "com.atproto.repo.applyWrites#updateResult"
        )
      ) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to post comment"
              description="Failed to write comment to the database"
              statusCode={500}
            />
          </Layout>,
          500,
        );
      }

      await c
        .get("ctx")
        .db.insertInto("buzz")
        .values({
          uri: firstResult.uri,
          cid: firstResult.cid,
          userDid: agent.assertDid,
          createdAt: createdAt,
          indexedAt: new Date().toISOString(),
          hiveId: hiveId as HiveId,
          comment,
          parentUri,
          parentCid,
          bookCid: book.cid,
          bookUri: book.uri,
        })
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet((c) => ({
            indexedAt: c.ref("excluded.indexedAt"),
            cid: c.ref("excluded.cid"),
            userDid: c.ref("excluded.userDid"),
            createdAt: c.ref("excluded.createdAt"),
            hiveId: c.ref("excluded.hiveId"),
            comment: c.ref("excluded.comment"),
            parentUri: c.ref("excluded.parentUri"),
            parentCid: c.ref("excluded.parentCid"),
            bookCid: c.ref("excluded.bookCid"),
            bookUri: c.ref("excluded.bookUri"),
          })),
        )
        .execute();

      return c.redirect("/books/" + hiveId);
    },
  );

  app.use("/comments/:commentId", methodOverride({ app }));

  app.delete("/comments/:commentId", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to delete a comment"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    const commentId = c.req.param("commentId") as string;
    const commentUri = `at://${agent.assertDid}/${ids.BuzzBookhiveBuzz}/${commentId}`;

    const comment = await c
      .get("ctx")
      .db.selectFrom("buzz")
      .selectAll()
      .where("userDid", "=", agent.assertDid)
      .where("uri", "=", commentUri)
      .execute();

    if (comment.length === 0) {
      return c.json({ success: false, commentId, book: null });
    }

    await agent.com.atproto.repo.deleteRecord({
      repo: agent.assertDid,
      collection: ids.BuzzBookhiveBuzz,
      rkey: commentId,
    });

    await c
      .get("ctx")
      .db.deleteFrom("buzz")
      .where("userDid", "=", agent.assertDid)
      .where("uri", "=", commentUri)
      .execute();

    if (c.req.header()["accept"] === "application/json") {
      return c.json({ success: true, commentId, comment: comment[0] });
    }

    return c.redirect("/books/" + comment[0].hiveId);
  });

  app.get("/books/:hiveId/comments", async (c) => {
    const book = await c
      .get("ctx")
      .db.selectFrom("hive_book")
      .selectAll()
      .where("id", "=", c.req.param("hiveId") as HiveId)
      .limit(1)
      .executeTakeFirst();

    if (!book) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Book not found"
            description="The book you are looking for does not exist"
            statusCode={404}
          />
        </Layout>,
        404,
      );
    }

    return c.render(<CommentsSection book={book} />, {
      title: "BookHive | Comments " + book.title,
      image: `${new URL(c.req.url).origin}/images/s_1190x665,fit_contain,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
      description: `Comments on ${book.title} by ${book.authors.split("\t").join(", ")} on BookHive, a Goodreads alternative built on Blue Sky`,
    });
  });

  app.post(
    "/api/update-book",
    zValidator(
      "json",
      z.object({
        hiveId: z.string(),
        status: z.optional(z.string()),
        review: z.optional(z.string()),
        stars: z.optional(z.number()),
        startedAt: z.optional(
          z
            .string()
            .transform((val) => {
              if (!val || val === "") return "";
              // If it's just a date (YYYY-MM-DD), convert to ISO-8601 at start of day
              if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                return new Date(val + "T00:00:00.000Z").toISOString();
              }
              return val;
            })
            .pipe(z.string().datetime().or(z.literal(""))),
        ),
        finishedAt: z.optional(
          z
            .string()
            .transform((val) => {
              if (!val || val === "") return "";
              // If it's just a date (YYYY-MM-DD), convert to ISO-8601 at start of day
              if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                return new Date(val + "T00:00:00.000Z").toISOString();
              }
              return val;
            })
            .pipe(z.string().datetime().or(z.literal(""))),
        ),
        bookProgress: z
          .union([
            z
              .object({
                percent: z.coerce.number().int().min(0).max(100).optional(),
                totalPages: z
                  .preprocess(
                    (val) => (val === "" ? undefined : val),
                    z.coerce.number().int().min(1),
                  )
                  .optional(),
                currentPage: z
                  .preprocess(
                    (val) => (val === "" ? undefined : val),
                    z.coerce.number().int().min(1),
                  )
                  .optional(),
                totalChapters: z
                  .preprocess(
                    (val) => (val === "" ? undefined : val),
                    z.coerce.number().int().min(1),
                  )
                  .optional(),
                currentChapter: z
                  .preprocess(
                    (val) => (val === "" ? undefined : val),
                    z.coerce.number().int().min(1),
                  )
                  .optional(),
              })
              .partial()
              .refine((value) => Object.keys(value).length > 0, {
                message: "bookProgress must include at least one value",
              }),
            z.null(),
          ])
          .optional(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        console.log("No agent");
        return c.json({ success: false, message: "Invalid Session" }, 401);
      }
      const payload = c.req.valid("json");
      const { hiveId, bookProgress, ...updates } = payload;

      let normalizedProgress: BookProgress | undefined | null =
        bookProgress as any;
      if (bookProgress && bookProgress !== null) {
        normalizedProgress = {
          ...bookProgress,
          updatedAt: new Date().toISOString(),
        };

        if (
          normalizedProgress.currentPage &&
          normalizedProgress.totalPages &&
          normalizedProgress.currentPage > normalizedProgress.totalPages
        ) {
          throw new Error("Current page cannot exceed total pages");
        }
        if (
          normalizedProgress.currentChapter &&
          normalizedProgress.totalChapters &&
          normalizedProgress.currentChapter > normalizedProgress.totalChapters
        ) {
          throw new Error("Current chapter cannot exceed total chapters");
        }
      }

      if (normalizedProgress !== undefined) {
        (updates as any).bookProgress = normalizedProgress;
        if (!updates.status) {
          updates.status = BOOK_STATUS.READING;
        }
      }

      if (!hiveId) {
        return c.json({ success: false, message: "Invalid ID" }, 400);
      }
      const bookLockKey = "book_lock:" + agent.assertDid;
      try {
        await c.get("ctx").kv.setItem(bookLockKey, hiveId);
        await updateBookRecord({
          ctx: c.get("ctx"),
          agent,
          hiveId: hiveId as HiveId,
          updates: updates,
        });
        return c.json({ success: true, message: "Book updated" });
      } catch (e) {
        return c.json({ success: false, message: (e as Error).message }, 400);
      } finally {
        await c.get("ctx").kv.del(bookLockKey);
      }
    },
  );

  app.post(
    "/api/update-comment",
    zValidator(
      "json",
      z.object({
        uri: z
          .string()
          .describe(
            "The URI of the comment to update. If this is not provided, a new comment will be created.",
          )
          .optional(),
        hiveId: z.string(),
        comment: z.string(),
        parentUri: z.string(),
        parentCid: z.string(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json(
          {
            success: false,
            message: "Invalid Session",
          },
          401,
        );
      }

      const { hiveId, comment, parentUri, parentCid, uri } =
        await c.req.valid("json");

      const originalBuzz = uri
        ? await c
            .get("ctx")
            .db.selectFrom("buzz")
            .selectAll()
            .where("uri", "=", uri)
            .limit(1)
            .executeTakeFirst()
        : null;
      const book = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .select(["cid", "uri"])
        .where("hiveId", "=", hiveId as HiveId)
        .executeTakeFirst();
      const createdAt = originalBuzz?.createdAt || new Date().toISOString();

      const bookRef = validateMain({ uri: book?.uri, cid: book?.cid });
      const parentRef = validateMain({ uri: parentUri, cid: parentCid });
      if (!bookRef.success || !parentRef.success || !book || !bookRef.value) {
        return c.json(
          {
            success: false,
            message: "Invalid Hive ID",
            description: "The book you are looking for does not exist",
          },
          404,
        );
      }

      const response = await agent.com.atproto.repo.applyWrites({
        repo: agent.assertDid,
        writes: [
          {
            $type: originalBuzz
              ? "com.atproto.repo.applyWrites#update"
              : "com.atproto.repo.applyWrites#create",
            collection: ids.BuzzBookhiveBuzz,
            rkey: originalBuzz
              ? originalBuzz.uri.split("/").at(-1)!
              : TID.nextStr(),
            value: {
              book: bookRef.value,
              comment,
              parent: parentRef.value,
              createdAt,
            },
          },
        ],
      });

      const firstResult = response.data.results?.[0];
      if (
        !response.success ||
        !response.data.results ||
        response.data.results.length === 0 ||
        !firstResult ||
        !(
          firstResult.$type === "com.atproto.repo.applyWrites#createResult" ||
          firstResult.$type === "com.atproto.repo.applyWrites#updateResult"
        )
      ) {
        return c.json(
          {
            success: false,
            message: "Failed to post comment",
            description: "Failed to write comment to the database",
          },
          500,
        );
      }

      await c
        .get("ctx")
        .db.insertInto("buzz")
        .values({
          uri: firstResult.uri,
          cid: firstResult.cid,
          userDid: agent.assertDid,
          createdAt: createdAt,
          indexedAt: new Date().toISOString(),
          hiveId: hiveId as HiveId,
          comment,
          parentUri,
          parentCid,
          bookCid: book.cid,
          bookUri: book.uri,
        })
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet((c) => ({
            indexedAt: c.ref("excluded.indexedAt"),
            cid: c.ref("excluded.cid"),
            userDid: c.ref("excluded.userDid"),
            createdAt: c.ref("excluded.createdAt"),
            hiveId: c.ref("excluded.hiveId"),
            comment: c.ref("excluded.comment"),
            parentUri: c.ref("excluded.parentUri"),
            parentCid: c.ref("excluded.parentCid"),
            bookCid: c.ref("excluded.bookCid"),
            bookUri: c.ref("excluded.bookUri"),
          })),
        )
        .execute();

      return c.json({
        success: true,
        message: "Comment posted",
        comment: {
          uri: firstResult.uri,
        },
      });
    },
  );

  // Follow (JSON)
  app.post(
    "/api/follow",
    zValidator(
      "json",
      z.object({
        did: z.string(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json({ success: false, message: "Invalid Session" }, 401);
      }
      const { did } = c.req.valid("json");
      if (!did || did === agent.assertDid) {
        return c.json({ success: false, message: "Invalid DID" }, 400);
      }

      try {
        const createdAt = new Date().toISOString();
        const response = await agent.com.atproto.repo.applyWrites({
          repo: agent.assertDid,
          writes: [
            {
              $type: "com.atproto.repo.applyWrites#create",
              collection: "app.bsky.graph.follow",
              rkey: TID.nextStr(),
              value: { subject: did, createdAt },
            },
          ],
        });

        const firstResult = response.data.results?.[0];
        if (
          !response.success ||
          !response.data.results ||
          response.data.results.length === 0 ||
          !firstResult ||
          firstResult.$type !== "com.atproto.repo.applyWrites#createResult"
        ) {
          throw new Error("Failed to follow user");
        }

        await c
          .get("ctx")
          .db.insertInto("user_follows")
          .values({
            userDid: agent.assertDid,
            followsDid: did,
            followedAt: createdAt,
            syncedAt: createdAt,
            lastSeenAt: createdAt,
            isActive: 1,
          })
          .onConflict((oc) =>
            oc.columns(["userDid", "followsDid"]).doUpdateSet({
              lastSeenAt: createdAt,
              isActive: 1,
            }),
          )
          .execute();

        return c.json({ success: true });
      } catch (e: any) {
        return c.json(
          { success: false, message: e?.message || "Follow failed" },
          400,
        );
      }
    },
  );

  // Follow (Form)
  app.post(
    "/api/follow-form",
    zValidator(
      "form",
      z.object({
        did: z.string(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.redirect("/", 302);
      }
      const { did } = c.req.valid("form");
      let targetHandle = did;
      try {
        // Resolve handle for redirect target
        targetHandle = await c.get("ctx").resolver.resolveDidToHandle(did);
      } catch {}

      if (!did || did === agent.assertDid) {
        return c.redirect(`/profile/${targetHandle}`, 302);
      }

      try {
        const createdAt = new Date().toISOString();
        await agent.com.atproto.repo.applyWrites({
          repo: agent.assertDid,
          writes: [
            {
              $type: "com.atproto.repo.applyWrites#create",
              collection: "app.bsky.graph.follow",
              rkey: TID.nextStr(),
              value: { subject: did, createdAt },
            },
          ],
        });

        const now = new Date().toISOString();
        await c
          .get("ctx")
          .db.insertInto("user_follows")
          .values({
            userDid: agent.assertDid,
            followsDid: did,
            followedAt: createdAt,
            syncedAt: now,
            lastSeenAt: now,
            isActive: 1,
          })
          .onConflict((oc) =>
            oc.columns(["userDid", "followsDid"]).doUpdateSet({
              lastSeenAt: now,
              isActive: 1,
            }),
          )
          .execute();
      } catch {}

      return c.redirect(`/profile/${targetHandle}`, 302);
    },
  );

  app.get(
    "/xrpc/" + ids.BuzzBookhiveSearchBooks,
    zValidator(
      "query",
      z.object({
        q: z.string(),
        limit: z.coerce.number().default(25),
        offset: z.coerce.number().optional().default(0),
        id: z.string().optional(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json({ success: false, message: "Invalid Session" }, 401);
      }
      const { q, limit, offset, id } = c.req.valid("query");

      if (id) {
        // short-circuit if we have an ID to look up
        const book = await c
          .get("ctx")
          .db.selectFrom("hive_book")
          .selectAll()
          .where("hive_book.id", "=", id as HiveId)
          .limit(1)
          .executeTakeFirst();

        return c.json([book].filter(Boolean));
      }

      const bookIds = await searchBooks({ query: q, ctx: c.get("ctx") });

      if (!bookIds.length) {
        return c.json([]);
      }

      const books = await c
        .get("ctx")
        .db.selectFrom("hive_book")
        .selectAll()
        .where("id", "in", bookIds)
        .limit(limit * offset + limit)
        .execute();

      books.sort((a, b) => {
        return bookIds.indexOf(a.id) - bookIds.indexOf(b.id);
      });

      return c.json(books.slice(offset, offset + limit));
    },
  );

  app.get(
    "/xrpc/" + ids.BuzzBookhiveGetBookIdMap,
    zValidator(
      "query",
      z
        .object({
          hiveId: z.string().optional(),
          isbn: z.string().optional(),
          isbn13: z.string().optional(),
          goodreadsId: z.string().optional(),
        })
        .refine(
          ({ hiveId, isbn, isbn13, goodreadsId }) =>
            Boolean(hiveId || isbn || isbn13 || goodreadsId),
          {
            message:
              "At least one identifier is required: hiveId, isbn, isbn13, or goodreadsId",
          },
        ),
    ),
    async (c) => {
      const ctx = c.get("ctx");
      const query = c.req.valid("query");

      const hiveId = normalizeHiveId(query.hiveId);
      const isbn = normalizeIsbn(query.isbn);
      const isbn13 = normalizeIsbn13(query.isbn13);
      const goodreadsId = normalizeGoodreadsId(query.goodreadsId);

      if (!hiveId && !isbn && !isbn13 && !goodreadsId) {
        return c.json(
          {
            success: false,
            message:
              "Invalid identifier. Provide hiveId, isbn, isbn13, or goodreadsId.",
          },
          400,
        );
      }

      let bookIdMap = await findBookIdMapByLookup({
        ctx,
        hiveId,
        isbn,
        isbn13,
        goodreadsId,
      });

      let hiveBook: HiveBook | undefined;
      if (bookIdMap) {
        hiveBook = await ctx.db
          .selectFrom("hive_book")
          .selectAll()
          .where("id", "=", bookIdMap.hiveId)
          .executeTakeFirst();
      } else {
        hiveBook = await findHiveBookByBookIdLookup({
          ctx,
          hiveId,
          isbn,
          isbn13,
          goodreadsId,
        });
      }

      if (!bookIdMap && !hiveBook) {
        return c.json({ success: false, message: "Book not found" }, 404);
      }

      if (hiveBook) {
        await ensureBookIdMapCurrent({ ctx, book: hiveBook });
        bookIdMap = await ctx.db
          .selectFrom("book_id_map")
          .selectAll()
          .where("hiveId", "=", hiveBook.id)
          .executeTakeFirst();
      }

      if (!bookIdMap) {
        if (!hiveBook) {
          return c.json({ success: false, message: "Book not found" }, 404);
        }
        const response = {
          bookIdMap: toBookIdMapOutput(deriveBookIdMap(hiveBook)),
        } satisfies GetBookIdMap.OutputSchema;
        return c.json(response);
      }

      const response = {
        bookIdMap: toBookIdMapOutput(bookIdMap),
      } satisfies GetBookIdMap.OutputSchema;
      return c.json(response);
    },
  );

  app.get(
    "/xrpc/" + ids.BuzzBookhiveGetBook,
    zValidator(
      "query",
      z.object({
        id: z.string(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json({ success: false, message: "Invalid Session" }, 401);
      }
      const { id } = c.req.valid("query");

      if (!id) {
        return c.json({ success: false, message: "Invalid ID" }, 400);
      }

      // short-circuit if we have an ID to look up
      const book = await c
        .get("ctx")
        .db.selectFrom("hive_book")
        .selectAll()
        .where("hive_book.id", "=", id as HiveId)
        .limit(1)
        .executeTakeFirst();

      if (!book) {
        return c.json({ success: false, message: "Book not found" }, 404);
      }

      const comments = await c
        .get("ctx")
        .db.selectFrom("buzz")
        .select([
          "buzz.bookUri",
          "buzz.bookCid",
          "buzz.comment",
          "buzz.createdAt",
          "buzz.userDid",
          "buzz.parentUri",
          "buzz.parentCid",
          "buzz.cid",
          "buzz.uri",
        ])
        .where("buzz.hiveId", "=", book.id)
        .orderBy("buzz.createdAt", "desc")
        .limit(3000)
        .execute();

      const topLevelReviews = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .select([
          "user_book.review as comment",
          "user_book.createdAt",
          "user_book.stars",
          "user_book.userDid",
          "user_book.uri",
          "user_book.cid",
        ])
        .where("user_book.hiveId", "=", book.id)
        .where("user_book.review", "is not", null)
        .$narrowType<{ comment: NotNull }>()
        .orderBy("user_book.createdAt", "desc")
        .limit(1000)
        .execute();

      const rawUserBook = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .selectAll()
        .where("user_book.hiveId", "=", book.id)
        .where("user_book.userDid", "=", agent.assertDid)
        .executeTakeFirst();
      const userBook = rawUserBook ? hydrateUserBook(rawUserBook) : null;

      const peerBooks = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .selectAll()
        .where("hiveId", "==", book.id)
        .orderBy("indexedAt", "desc")
        .limit(100)
        .execute();

      const didToHandle = await c.get("ctx").resolver.resolveDidsToHandles(
        Array.from(
          new Set(
            comments
              .map((c) => c.userDid)
              .concat(topLevelReviews.map((r) => r.userDid))
              .concat(peerBooks.map((b) => b.userDid)),
          ),
        ),
      );

      const response = {
        createdAt: userBook?.createdAt,
        startedAt: userBook?.startedAt ?? undefined,
        finishedAt: userBook?.finishedAt ?? undefined,
        status: userBook?.status ?? undefined,
        stars: userBook?.stars ?? undefined,
        review: userBook?.review ?? undefined,
        bookProgress: userBook?.bookProgress ?? undefined,
        userBookUri: userBook?.uri ?? undefined,
        userBookCid: userBook?.cid ?? undefined,
        book: {
          $type: "buzz.bookhive.hiveBook",
          title: book.title,
          authors: book.authors,
          cover: book.cover ?? undefined,
          hiveId: book.id,
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
          rating: book.rating ?? undefined,
          ratingsCount: book.ratingsCount ?? undefined,
          id: book.id,
          thumbnail: book.thumbnail ?? undefined,
          description: book.description ?? undefined,
          source: book.source ?? undefined,
          sourceId: book.sourceId ?? undefined,
          sourceUrl: book.sourceUrl ?? undefined,
        },
        comments: comments.map((c) => ({
          book: {
            cid: c.bookCid,
            uri: c.bookUri,
          },
          comment: c.comment,
          createdAt: c.createdAt,
          did: c.userDid,
          handle: didToHandle[c.userDid] ?? c.userDid,
          uri: c.uri,
          cid: c.cid,
          parent: {
            uri: c.parentUri,
            cid: c.parentCid,
          },
        })),
        reviews: topLevelReviews.map((r) => ({
          createdAt: r.createdAt,
          did: r.userDid,
          handle: didToHandle[r.userDid] ?? r.userDid,
          review: r.comment,
          stars: r.stars ?? undefined,
          uri: r.uri,
          cid: r.cid,
        })),
        activity: peerBooks.map((b) => ({
          type:
            b.status &&
            b.status in BOOK_STATUS_MAP &&
            BOOK_STATUS_MAP[b.status as keyof typeof BOOK_STATUS_MAP] === "read"
              ? "finished"
              : b.review
                ? "review"
                : "started",
          createdAt: b.createdAt,
          hiveId: b.hiveId,
          title: b.title,
          userDid: b.userDid,
          userHandle: didToHandle[b.userDid] ?? b.userDid,
        })),
      } satisfies GetBook.OutputSchema & {
        userBookUri?: string;
        userBookCid?: string;
      };

      return c.json(response);
    },
  );

  app.get(
    "/xrpc/" + ids.BuzzBookhiveGetProfile,
    zValidator(
      "query",
      z.object({
        did: z.string().optional(),
        handle: z.string().optional(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();

      let { did, handle } = c.req.valid("query");

      if (!did && !handle) {
        if (!agent) {
          return c.json(
            {
              success: false,
              message: "No did or handle specified, and no session",
            },
            401,
          );
        }
        did = agent.assertDid;
      }

      if (handle && !did) {
        did = await c.get("ctx").baseIdResolver.handle.resolve(handle);
      }
      did = did as string;
      console.log("did2", did);

      const books = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .select(BookFields)
        .where("user_book.userDid", "=", did)
        .orderBy("user_book.createdAt", "desc")
        .limit(1000)
        .execute();
      const profile = await getProfile({ ctx: c.get("ctx"), did });
      const friendsBuzzes = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .innerJoin(
          "user_follows",
          "user_book.userDid",
          "user_follows.followsDid",
        )
        .select(BookFields)
        .where("user_follows.userDid", "=", did)
        .where("user_follows.isActive", "=", 1)
        .orderBy("user_book.createdAt", "desc")
        .limit(50)
        .execute();
      const parsedBooks = books.map((book) => hydrateUserBook(book));
      const parsedFriendsBuzzes = friendsBuzzes.map((book) =>
        hydrateUserBook(book),
      );

      const didToHandle = await c
        .get("ctx")
        .resolver.resolveDidsToHandles(
          Array.from(
            new Set(
              books
                .map((c) => c.userDid)
                .concat(friendsBuzzes.map((r) => r.userDid)),
            ),
          ),
        );

      const isFollowing =
        agent && agent.assertDid !== did
          ? Boolean(
              await c
                .get("ctx")
                .db.selectFrom("user_follows")
                .select(["followsDid"]) // lightweight
                .where("userDid", "=", agent.assertDid)
                .where("followsDid", "=", did)
                .where("isActive", "=", 1)
                .executeTakeFirst(),
            )
          : undefined;

      const response = {
        profile: {
          displayName: profile?.displayName ?? profile?.handle ?? did,
          avatar: profile?.avatar,
          handle: profile?.handle ?? did,
          description: profile?.description,
          booksRead: books.filter(
            (b) =>
              b.status &&
              b.status in BOOK_STATUS_MAP &&
              BOOK_STATUS_MAP[b.status as keyof typeof BOOK_STATUS_MAP] ===
                "read",
          ).length,
          reviews: books.filter((b) => b.review).length,
          isFollowing,
        },
        friendActivity: parsedFriendsBuzzes.map((b) => ({
          userDid: b.userDid,
          userHandle: didToHandle[b.userDid] ?? b.userDid,
          authors: b.authors,
          createdAt: b.createdAt,
          hiveId: b.hiveId,
          title: b.title,
          thumbnail: b.thumbnail || "",
          cover: b.cover ?? b.thumbnail ?? undefined,
          finishedAt: b.finishedAt ?? undefined,
          review: b.review ?? undefined,
          stars: b.stars ?? undefined,
          status: b.status ?? undefined,
          description: b.description ?? undefined,
          rating: b.rating ?? undefined,
          startedAt: b.startedAt ?? undefined,
          bookProgress: b.bookProgress ?? undefined,
        })),
        books: parsedBooks.map((b) => ({
          userDid: b.userDid,
          userHandle: didToHandle[b.userDid] ?? b.userDid,
          authors: b.authors,
          createdAt: b.createdAt,
          hiveId: b.hiveId,
          title: b.title,
          thumbnail: b.thumbnail || "",
          cover: b.cover ?? b.thumbnail ?? undefined,
          finishedAt: b.finishedAt ?? undefined,
          review: b.review ?? undefined,
          stars: b.stars ?? undefined,
          status: b.status ?? undefined,
          description: b.description ?? undefined,
          rating: b.rating ?? undefined,
          startedAt: b.startedAt ?? undefined,
          bookProgress: b.bookProgress ?? undefined,
        })),
        activity: books
          .reduce(
            (acc, b) => {
              const existing = acc.find((a) => a.hiveId === b.hiveId);
              if (
                !existing ||
                new Date(b.createdAt) > new Date(existing.createdAt)
              ) {
                if (existing) {
                  acc.splice(acc.indexOf(existing), 1);
                }
                acc.push({
                  type:
                    b.status &&
                    b.status in BOOK_STATUS_MAP &&
                    BOOK_STATUS_MAP[
                      b.status as keyof typeof BOOK_STATUS_MAP
                    ] === "read"
                      ? "finished"
                      : b.review
                        ? "review"
                        : "started",
                  createdAt: b.createdAt,
                  hiveId: b.hiveId,
                  title: b.title,
                  userDid: b.userDid,
                  userHandle: didToHandle[b.userDid] ?? b.userDid,
                });
              }
              return acc;
            },
            [] as Array<{
              type: string;
              createdAt: string;
              hiveId: string;
              title: string;
              userDid: string;
              userHandle: string;
            }>,
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, 15),
      } satisfies GetProfile.OutputSchema;

      return c.json(response);
    },
  );
}
