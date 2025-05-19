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
import type { NotNull } from "kysely";
import type { AppContext, HonoServer } from ".";
import { loginRouter } from "./auth/router";
import { ids } from "./bsky/lexicon/lexicons";
import * as BookRecord from "./bsky/lexicon/types/buzz/bookhive/book";
import * as BuzzRecord from "./bsky/lexicon/types/buzz/bookhive/buzz";
import type * as GetBook from "./bsky/lexicon/types/buzz/bookhive/getBook";
import type * as GetProfile from "./bsky/lexicon/types/buzz/bookhive/getProfile";
import { validateMain } from "./bsky/lexicon/types/com/atproto/repo/strongRef";
import { BOOK_STATUS_MAP } from "./constants";
import { BookFields } from "./db";
import { BookInfo } from "./pages/bookInfo";
import { CommentsSection } from "./pages/comments";
import { Error as ErrorPage } from "./pages/error";
import { Home } from "./pages/home";
import { Layout } from "./pages/layout";
import { Navbar } from "./pages/navbar";
import { ProfilePage } from "./pages/profile";
import { findBookDetails } from "./scrapers";
import { type HiveId } from "./types";
import { updateBookRecord } from "./utils/getBook";
import { getProfile } from "./utils/getProfile";
import { readThroughCache } from "./utils/readThroughCache";

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
  ctx: Pick<AppContext, "db" | "kv">;
}) {
  return await readThroughCache<HiveId[]>(
    ctx.kv,
    `search:${query}`,
    () =>
      findBookDetails(query).then((res) => {
        if (!res.success) {
          throw new Error(res.message);
        }

        return ctx.db
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
      }),
    [] as HiveId[],
    {
      requestsPerSecond: 5,
    },
  );
}

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
        ctx.logger.error("hiveId not found for book", { record });
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
      ctx.logger.info("Duplicate book found", { records });
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
      .values({
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
      })
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

      // Fetch books/buzzes on login, but don't wait for it
      await Promise.race([
        refetchBooks({ agent, ctx }).then(() => refetchBuzzes({ agent, ctx })),
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
    // const didHandleMap = await c
    //   .get("ctx")
    //   .resolver.resolveDidsToHandles([]);

    return c.render(<Home />, {
      title: "BookHive | Home",
    });
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

  app.get("/profile/:handle", async (c) => {
    const handle = c.req.param("handle");

    const did = isDid(handle)
      ? handle
      : await c.get("ctx").baseIdResolver.handle.resolve(handle);

    const agent = await c.get("ctx").getSessionAgent();

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

    // if (!profileRecord) {
    //   return c.render(
    //     <Fragment>
    //       <h1>Profile {handle} not found</h1>
    //       <p>
    //         This profile may not exist or has not logged any books on bookhive
    //       </p>
    //     </Fragment>,
    //   );
    // }

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

    return c.render(
      <ProfilePage
        isBuzzer={isBuzzer}
        handle={handle}
        books={books}
        profile={profile}
        isOwner={agent?.did === did}
      />,
      {
        title: "BookHive | @" + handle,
        description: `@${handle}'s BookHive Profile page with ${books.length} books`,
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

    const bookId = c.req.param("hiveId") as HiveId;
    const bookUri = `at://${agent.assertDid}/${ids.BuzzBookhiveBook}/${bookId}`;

    const book = await c
      .get("ctx")
      .db.selectFrom("user_book")
      .selectAll()
      .where("userDid", "=", agent.assertDid)
      .where("uri", "=", bookUri)
      .execute();

    if (book.length === 0) {
      return c.json({ success: false, bookId, book: null });
    }

    await agent.com.atproto.repo.deleteRecord({
      repo: agent.assertDid,
      collection: ids.BuzzBookhiveBook,
      rkey: bookId,
    });

    await c
      .get("ctx")
      .db.deleteFrom("user_book")
      .where("userDid", "=", agent.assertDid)
      .where("uri", "=", bookUri)
      .execute();

    if (c.req.header()["accept"] === "application/json") {
      return c.json({ success: true, bookId, book: book[0] });
    }

    return c.redirect("/books/" + book[0].hiveId);
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
        } = await c.req.valid("form");

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
        startedAt: z.optional(z.string().datetime()),
        finishedAt: z.optional(z.string().datetime()),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        console.log("No agent");
        return c.json({ success: false, message: "Invalid Session" }, 401);
      }
      const { hiveId, ...rest } = c.req.valid("json");

      if (!hiveId) {
        console.log("No hiveId");
        return c.json({ success: false, message: "Invalid ID" }, 400);
      }
      const bookLockKey = "book_lock:" + agent.assertDid;
      try {
        await c.get("ctx").kv.setItem(bookLockKey, hiveId);
        await updateBookRecord({
          ctx: c.get("ctx"),
          agent,
          hiveId: hiveId as HiveId,
          updates: {
            ...rest,
          },
        });
        return c.json({ success: true, message: "Book updated" });
      } catch (e) {
        return c.json({ success: false, message: (e as Error).message }, 400);
      } finally {
        await c.get("ctx").kv.del(bookLockKey);
      }
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

      const userBook = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .selectAll()
        .where("user_book.hiveId", "=", book.id)
        .executeTakeFirst();

      const response = {
        createdAt: userBook?.createdAt,
        startedAt: userBook?.startedAt ?? undefined,
        finishedAt: userBook?.finishedAt ?? undefined,
        status: userBook?.status ?? undefined,
        stars: userBook?.stars ?? undefined,
        review: userBook?.review ?? undefined,
        book: {
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
          // map this id to a handle
          handle: c.userDid,
          parent: {
            uri: c.parentUri,
            cid: c.parentCid,
          },
        })),
        reviews: topLevelReviews.map((r) => ({
          createdAt: r.createdAt,
          did: r.userDid,
          // map this id to a handle
          handle: r.userDid,
          review: r.comment,
          stars: r.stars ?? undefined,
        })),
      } satisfies GetBook.OutputSchema;

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
        },
        books: books.map((b) => ({
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
                });
              }
              return acc;
            },
            [] as Array<{
              type: string;
              createdAt: string;
              hiveId: string;
              title: string;
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
