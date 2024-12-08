/** @jsx createElement */
import { TID } from "@atproto/common";
import { methodOverride } from "hono/method-override";
import { Agent, isDid } from "@atproto/api";
import { zValidator } from "@hono/zod-validator";
// @ts-expect-error
import { createElement, Fragment } from "hono/jsx";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { z } from "zod";

import type { AppContext, HonoServer } from ".";
import { loginRouter } from "./auth/router";
import { ids } from "./bsky/lexicon/lexicons";
import * as Book from "./bsky/lexicon/types/buzz/bookhive/book";
import type { HiveId } from "./db";
import { BookInfo } from "./pages/bookInfo";
import { Error as ErrorPage } from "./pages/error";
import { Home } from "./pages/home";
import { Layout } from "./pages/layout";
import { Navbar } from "./pages/navbar";
import { ProfilePage } from "./pages/profile";
import { findBookDetails } from "./scrapers";
import { readThroughCache } from "./utils/readThroughCache";
import { uploadImageBlob } from "./utils/uploadImageBlob";

declare module "hono" {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response;
  }
}
async function refetchBooks({
  agent,
  ctx,
  cursor,
}: {
  agent: Agent;
  ctx: AppContext;
  cursor?: string;
}) {
  if (!agent) {
    return;
  }
  const books = await agent.com.atproto.repo.listRecords({
    repo: agent.assertDid,
    collection: ids.BuzzBookhiveBook,
    limit: 100,
    cursor,
  });

  if (!cursor) {
    // Clear existing books
    await ctx.db
      .deleteFrom("user_book")
      .where("userDid", "=", agent.assertDid)
      .execute();
  }

  await books.data.records
    .filter((record) => Book.validateRecord(record.value).success)
    .reduce(async (acc, record) => {
      await acc;
      const book = record.value as Book.Record;

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
          oc.column("uri").doUpdateSet({
            indexedAt: new Date().toISOString(),
            title: book.title,
            authors: book.authors,
            status: book.status,
            startedAt: book.startedAt,
            finishedAt: book.finishedAt,
            hiveId: book.hiveId as HiveId,
            review: book.review,
            stars: book.stars,
          }),
        )
        .execute();
    }, Promise.resolve());

  // TODO optimize this
  if (books.data.records.length === 100) {
    // Fetch next page, after a short delay
    await setTimeout(() => {}, 100);
    return refetchBooks({ agent, ctx, cursor: books.data.cursor });
  }
}

export function createRouter(app: HonoServer) {
  loginRouter(app, {
    onLogin: async ({ agent, ctx }) => {
      if (!agent) {
        return;
      }

      // Fetch books on login
      await refetchBooks({ agent, ctx });
    },
  });

  app.use(
    jsxRenderer(async ({ children, title = "Book Hive" }) => {
      const c = useRequestContext();
      const profile = await c.get("ctx").getProfile();

      return (
        <Layout title={title}>
          <Navbar profile={profile} />
          {children}
        </Layout>
      );
    }),
  );

  // Homepage
  app.get("/", async (c) => {
    // const didHandleMap = await c
    //   .get("ctx")
    //   .resolver.resolveDidsToHandles([]);

    return c.render(<Home />, {
      title: "Book Hive | Home",
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

    const books = await c
      .get("ctx")
      .db.selectFrom("user_book")
      .selectAll()
      .where("userDid", "=", agent.assertDid)
      .orderBy("indexedAt", "desc")
      .limit(10)
      .execute();

    return c.json(books);
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

    const agent =
      (await c.get("ctx").getSessionAgent()) ||
      new Agent("https://public.api.bsky.app/xrpc");
    const profile = await readThroughCache(
      c.get("ctx"),
      "profile:" + did,
      async () => {
        return agent
          .getProfile({
            actor: did,
          })
          .then((res) => res.data);
      },
    );
    const books = isBuzzer
      ? await c
          .get("ctx")
          .db.selectFrom("user_book")
          .innerJoin("hive_book", "user_book.hiveId", "hive_book.id")
          .selectAll()
          .where("user_book.userDid", "=", did)
          .orderBy("user_book.indexedAt", "desc")
          .limit(100)
          .execute()
      : [];

    return c.render(
      <ProfilePage
        isBuzzer={isBuzzer}
        handle={handle}
        books={books}
        profile={profile}
      />,
      { title: "Book Hive | @" + handle },
    );
  });

  app.get("/books/:id", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to view a book"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }
    const book = await c
      .get("ctx")
      .db.selectFrom("hive_book")
      .selectAll()
      .where("id", "=", c.req.param("id") as HiveId)
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
      title: "Book Hive | " + book.title,
    });
  });

  app.use("/books/:id", methodOverride({ app }));

  app.delete("/books/:id", async (c) => {
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

    const bookId = c.req.param("id");
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

        const userBook = await c
          .get("ctx")
          .db.selectFrom("user_book")
          .selectAll()
          .where("userDid", "=", agent.assertDid)
          .where("hiveId", "=", hiveId as HiveId)
          .executeTakeFirst();

        let originalBook: Book.Record | undefined = undefined;
        if (userBook) {
          const {
            data: { value: originalBookValue },
          } = await agent.com.atproto.repo.getRecord({
            repo: agent.assertDid,
            collection: ids.BuzzBookhiveBook,
            rkey: userBook.uri.split("/").at(-1)!,
            cid: userBook.cid,
          });
          originalBook = originalBookValue as Book.Record;
        }

        const input = {
          title: originalBook?.title || title,
          authors: originalBook?.authors || authors,
          hiveId: originalBook?.hiveId || hiveId,
          cover:
            originalBook?.cover || (await uploadImageBlob(coverImage, agent)),
          status: status || originalBook?.status || undefined,
          createdAt: originalBook?.createdAt || new Date().toISOString(),
          startedAt: startedAt || originalBook?.startedAt || undefined,
          finishedAt: finishedAt || originalBook?.finishedAt || undefined,
          review: review || originalBook?.review || undefined,
          stars: stars || originalBook?.stars || undefined,
        };
        const book = Book.validateRecord(input);

        if (!book.success) {
          return c.html(
            <Layout>
              <ErrorPage
                message="Invalid book"
                description={
                  "When validating the book you inputted, it was invalid because: " +
                  book.error.message
                }
                statusCode={400}
              />
            </Layout>,
            400,
          );
        }

        const record = book.value as Book.Record;

        const response = await agent.com.atproto.repo.applyWrites({
          repo: agent.assertDid,
          writes: [
            {
              $type: originalBook
                ? "com.atproto.repo.applyWrites#update"
                : "com.atproto.repo.applyWrites#create",
              collection: ids.BuzzBookhiveBook,
              rkey: userBook ? userBook.uri.split("/").at(-1) : TID.nextStr(),
              value: record as Book.Record,
            },
          ],
        });

        if (
          !response.success ||
          !response.data.results ||
          response.data.results.length === 0
        ) {
          return c.html(
            <Layout>
              <ErrorPage
                message="Failed to record book"
                description="Failed to write book to the database"
                statusCode={500}
              />
            </Layout>,
            500,
          );
        }

        await c
          .get("ctx")
          .db.insertInto("user_book")
          .values({
            uri: response.data.results[0].uri as string,
            cid: response.data.results[0].cid as string,
            userDid: agent.assertDid,
            createdAt: record.createdAt,
            authors: record.authors,
            title: record.title,
            indexedAt: new Date().toISOString(),
            hiveId: record.hiveId as HiveId,
            status: record.status,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
            review: record.review,
            stars: record.stars,
          })
          .onConflict((oc) =>
            oc.column("uri").doUpdateSet({
              indexedAt: new Date().toISOString(),
              cid: response.data.results?.[0].cid as string,
              authors: record.authors,
              title: record.title,
              hiveId: record.hiveId as HiveId,
              status: record.status,
              startedAt: record.startedAt,
              finishedAt: record.finishedAt,
              review: record.review,
              stars: record.stars,
            }),
          )
          .execute();

        return c.redirect("/books/" + hiveId);
      } catch (err) {
        c.get("ctx").logger.warn({ err }, "failed to write book");
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
        return c.html(
          <Layout>
            <ErrorPage
              message="Invalid Session"
              description="Login to post a review"
              statusCode={401}
            />
          </Layout>,
          401,
        );
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

      const bookIds = await readThroughCache<HiveId[]>(
        c.get("ctx"),
        `search:${q}`,
        () =>
          findBookDetails(q).then((res) => {
            if (!res.success) {
              throw new Error(res.message);
            }
            console.log(res.data);

            return c
              .get("ctx")
              .db.insertInto("hive_book")
              .values(res.data)
              .onConflict((oc) =>
                oc.column("id").doUpdateSet((c) => ({
                  rating: c.ref("rating"),
                  ratingsCount: c.ref("ratingsCount"),
                  updatedAt: c.ref("updatedAt"),
                })),
              )
              .execute()
              .then(() => {
                return res.data.map((book) => book.id);
              });
          }),
        [] as HiveId[],
      );

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
}
