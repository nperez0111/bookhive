/** @jsx createElement */
// @ts-expect-error
import { createElement } from "hono/jsx";
import assert from "node:assert";
import { TID } from "@atproto/common";
import { isValidHandle } from "@atproto/syntax";
import { getIronSession } from "iron-session";
import type { Hono } from "hono";

import { Agent } from "@atproto/api";
import type { AppContext } from ".";
import { Layout } from "./pages/layout";
import { env } from "./env";
import { OAuthResolverError } from "@atproto/oauth-client-node";

import * as Profile from "./bsky/lexicon/types/app/bsky/actor/profile";
import * as Book from "./bsky/lexicon/types/buzz/bookhive/book";
import * as BookReview from "./bsky/lexicon/types/buzz/bookhive/review";
import { Login } from "./pages/login";
import { Home } from "./pages/home";
import { Error } from "./pages/error";
import { ids } from "./bsky/lexicon/lexicons";

type Session = { did: string };

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(req: Request, res: Response, ctx: AppContext) {
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

export function createRouter(ctx: AppContext, app: Hono) {
  // OAuth metadata
  app.get("/client-metadata.json", async (c) => {
    return c.json(ctx.oauthClient.clientMetadata);
  });

  // OAuth callback to complete session creation
  app.get("/oauth/callback", async (c) => {
    const params = new URLSearchParams(c.req.url.split("?")[1]);
    try {
      const { session } = await ctx.oauthClient.callback(params);
      const clientSession = await getIronSession<Session>(c.req.raw, c.res, {
        cookieName: "sid",
        password: env.COOKIE_SECRET,
      });
      assert(!clientSession.did, "session already exists");
      clientSession.did = session.did;
      await clientSession.save();
    } catch (err) {
      ctx.logger.error({ err }, "oauth callback failed");
      return c.redirect("/?error");
    }
    return c.redirect("/");
  });

  // Login page
  app.get("/login", (c) => {
    return c.html(
      <Layout>
        <Login />
      </Layout>,
    );
  });

  // Login handler
  app.post("/login", async (c) => {
    const { handle } = await c.req.parseBody();
    if (typeof handle !== "string" || !isValidHandle(handle)) {
      return c.html(
        <Layout>
          <Login error={"Handle" + handle + "is invalid"} />
        </Layout>,
        400,
      );
    }

    try {
      const url = await ctx.oauthClient.authorize(handle, {
        scope: "atproto transition:generic",
      });
      return c.redirect(url.toString());
    } catch (err) {
      ctx.logger.error({ err }, "oauth authorize failed");
      const error =
        err instanceof OAuthResolverError
          ? err.message
          : "Couldn't initiate login";
      return c.html(
        <Layout>
          <Error
            message={error}
            description="Oath authorization failed"
            statusCode={400}
          />
        </Layout>,
        400,
      );
    }
  });

  // Logout handler
  app.post("/logout", async (c) => {
    const session = await getIronSession<Session>(c.req.raw, c.res, {
      cookieName: "sid",
      password: env.COOKIE_SECRET,
    });
    await session.destroy();
    return c.redirect("/");
  });

  // Homepage (improved version)
  app.get("/", async (c) => {
    const agent = await getSessionAgent(c.req.raw, c.res, ctx);

    const reviews = await ctx.db
      .selectFrom("book_review")
      .selectAll()
      .orderBy("indexedAt", "desc")
      .limit(10)
      .execute();

    const myBooks = agent
      ? await ctx.db
          .selectFrom("book")
          .selectAll()
          .where("authorDid", "=", agent.assertDid)
          .orderBy("indexedAt", "desc")
          .limit(10)
          .execute()
      : undefined;

    const didHandleMap = await ctx.resolver.resolveDidsToHandles(
      reviews.map((s) => s.authorDid),
    );

    if (!agent) {
      return c.html(
        <Layout>
          <Home latestReviews={reviews} didHandleMap={didHandleMap} />
        </Layout>,
      );
    }

    const { data: profileRecord } = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: ids.AppBskyActorProfile,
      rkey: "self",
    });

    const profile =
      Profile.isRecord(profileRecord.value) &&
      Profile.validateRecord(profileRecord.value).success
        ? profileRecord.value
        : {};

    return c.html(
      <Layout>
        <Home
          latestReviews={reviews}
          didHandleMap={didHandleMap}
          profile={profile}
          myBooks={myBooks}
        />
      </Layout>,
    );
  });

  app.get("/refresh-books", async (c) => {
    const agent = await getSessionAgent(c.req.raw, c.res, ctx);
    if (!agent) {
      return c.html(
        <Layout>
          <Error
            message="Invalid Session"
            description="Login to refresh books"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    async function fetchBooks(cursor?: string) {
      if (!agent) {
        return;
      }
      const books = await agent.com.atproto.repo.listRecords({
        repo: agent.assertDid,
        collection: ids.BuzzBookhiveBook,
        limit: 100,
        cursor,
      });

      await books.data.records.reduce(async (acc, record) => {
        await acc;
        const book = record.value as Book.Record;

        await ctx.db
          .insertInto("book")
          .values({
            uri: record.uri,
            cid: record.cid,
            authorDid: agent.assertDid,
            createdAt: book.createdAt,
            indexedAt: new Date().toISOString(),
            author: book.author,
            title: book.title,
            // cover: book.cover?.toString(),
            isbn: book.isbn?.join(","),
            year: book.year,
            status: book.status,
          })
          .onConflict((oc) =>
            oc.column("uri").doUpdateSet({
              indexedAt: new Date().toISOString(),
            }),
          )
          .execute();
      }, Promise.resolve());

      if (books.data.records.length === 100) {
        // Fetch next page, after a short delay
        await setTimeout(() => {}, 100);
        return fetchBooks(books.data.cursor);
      }
    }

    await fetchBooks();

    const books = await ctx.db
      .selectFrom("book")
      .selectAll()
      .where("authorDid", "=", agent.assertDid)
      .orderBy("indexedAt", "desc")
      .limit(10)
      .execute();

    return c.json(books);
  });

  app.post("/books", async (c) => {
    const agent = await getSessionAgent(c.req.raw, c.res, ctx);
    if (!agent) {
      return c.html(
        <Layout>
          <Error
            message="Invalid Session"
            description="Login to add a book"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    const { author, title, year, status, isbn } = await c.req.parseBody();
    const rkey = TID.nextStr();
    const record = {
      $type: ids.BuzzBookhiveBook,
      createdAt: new Date().toISOString(),
      author: author as string,
      title: title as string,
      // cover
      year: year !== undefined ? parseInt(year as string, 10) : undefined,
      status: status as string,
      isbn: isbn ? (isbn as string).split(",") : undefined,
    } satisfies Book.Record;

    if (!Book.validateRecord(record).success) {
      return c.html(
        <Layout>
          <Error
            message="Invalid book"
            description="When validating the book you inputted, it was invalid"
            statusCode={400}
          />
        </Layout>,
        400,
      );
    }

    try {
      const res = await agent.com.atproto.repo.putRecord({
        repo: agent.assertDid,
        collection: ids.BuzzBookhiveBook,
        rkey,
        record,
        validate: false,
      });

      await ctx.db
        .insertInto("book")
        .values({
          uri: res.data.uri,
          cid: res.data.cid,
          authorDid: agent.assertDid,
          createdAt: record.createdAt,
          indexedAt: new Date().toISOString(),
          author: record.author,
          title: record.title,
          // cover: record.cover?.toString(),
          isbn: record.isbn?.join(","),
          year: record.year,
          status: record.status,
        })
        .execute();

      return c.redirect("/");
    } catch (err) {
      ctx.logger.warn({ err }, "failed to write book");
      return c.html(
        <Layout>
          <Error
            message="Failed to record book"
            description={"Error: " + (err as Error).message}
            statusCode={500}
          />
        </Layout>,
        500,
      );
    }
  });

  app.post("/reviews", async (c) => {
    const agent = await getSessionAgent(c.req.raw, c.res, ctx);
    if (!agent) {
      return c.html(
        <Layout>
          <Error
            message="Invalid Session"
            description="Login to post a review"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }

    const { bookUri, bookCid, commentUri, commentCid, stars } =
      await c.req.parseBody();
    const rkey = TID.nextStr();
    const record = {
      $type: ids.BuzzBookhiveReview,
      createdAt: new Date().toISOString(),
      book: {
        $type: ids.ComAtprotoRepoStrongRef,
        uri: bookUri as string,
        cid: bookCid as string,
      },
      comment:
        commentUri && commentCid
          ? {
              $type: ids.ComAtprotoRepoStrongRef,
              uri: commentUri as string,
              cid: commentCid as string,
            }
          : undefined,
      stars: stars ? parseInt(stars as string, 10) : undefined,
    } satisfies BookReview.Record;

    if (!BookReview.validateRecord(record).success) {
      return c.html(
        <Layout>
          <Error
            message="Invalid review"
            description="When validating the review you inputted, it was invalid"
            statusCode={400}
          />
        </Layout>,
        400,
      );
    }

    try {
      const res = await agent.com.atproto.repo.putRecord({
        repo: agent.assertDid,
        collection: ids.BuzzBookhiveReview,
        rkey,
        record,
        validate: false,
      });

      await ctx.db
        .insertInto("book_review")
        .values({
          uri: res.data.uri,
          cid: res.data.cid,
          authorDid: agent.assertDid,
          bookUri: record.book.uri,
          bookCid: record.book.cid,
          commentUri: record.comment?.uri,
          commentCid: record.comment?.cid,
          stars: record.stars,
          createdAt: record.createdAt,
          indexedAt: new Date().toISOString(),
        })
        .execute();

      return c.redirect("/");
    } catch (err) {
      ctx.logger.warn({ err }, "failed to write record");
      return c.html(
        <Layout>
          <Error
            message="Failed to record review"
            description={"Error: " + (err as Error).message}
            statusCode={500}
          />
        </Layout>,
        500,
      );
    }
  });
}
