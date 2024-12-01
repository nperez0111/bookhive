/** @jsx createElement */
// @ts-expect-error
import { createElement, Fragment } from "hono/jsx";
import { TID } from "@atproto/common";
import sharp from "sharp";

import type { AppContext, HonoServer } from ".";
import { Layout } from "./pages/layout";

import * as Profile from "./bsky/lexicon/types/app/bsky/actor/profile";
import * as Book from "./bsky/lexicon/types/buzz/bookhive/book";
import * as Buzz from "./bsky/lexicon/types/buzz/bookhive/buzz";
import { Home } from "./pages/home";
import { Error } from "./pages/error";
import { ids } from "./bsky/lexicon/lexicons";
import { loginRouter } from "./auth/router";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { findBookDetails, type BookResult } from "./scrapers";
import type { BlobRef } from "@atproto/lexicon";
import { BookInfo } from "./pages/bookInfo";
import { isDid, type Agent } from "@atproto/api";
import type { StorageValue } from "unstorage";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { Navbar } from "./pages/navbar";
import { ProfilePage } from "./pages/profile";

function readThroughCache<T extends StorageValue>(
  ctx: AppContext,
  key: string,
  fetch: () => Promise<T>,
): Promise<T> {
  ctx.logger.trace({ key }, "readThroughCache");
  return ctx.kv.get<T>(key).then((cached) => {
    if (cached) {
      ctx.logger.trace({ key, cached }, "readThroughCache hit");
      return cached;
    }

    ctx.logger.trace({ key }, "readThroughCache miss");
    return fetch().then((fresh) => {
      ctx.logger.trace({ key, fresh }, "readThroughCache set");
      ctx.kv.set(key, fresh);
      return fresh;
    });
  });
}

async function getProfile(
  agent: Agent,
  ctx: AppContext,
): Promise<{
  profile: Profile.Record | null;
  profileAvatar: string | null;
}> {
  const profile = await readThroughCache(
    ctx,
    "profile:" + agent.assertDid,
    async () => {
      const { data: profileRecord } = await agent.com.atproto.repo.getRecord({
        repo: agent.assertDid,
        collection: ids.AppBskyActorProfile,
        rkey: "self",
      });

      const profile =
        Profile.isRecord(profileRecord.value) &&
        Profile.validateRecord(profileRecord.value).success
          ? profileRecord.value
          : undefined;
      if (!profile) {
        return null;
      }

      return profile;
    },
  );

  if (!profile) {
    return { profile: null, profileAvatar: null };
  }

  const profileAvatar = await readThroughCache(
    ctx,
    "profile:" + agent.assertDid + ":avatar",
    async () => {
      if (profile.avatar) {
        const resp = await agent.com.atproto.sync.getBlob({
          cid: profile.avatar?.ref.toString()!,
          did: agent.assertDid,
        });
        return (
          "data:" +
          profile.avatar.mimeType +
          ";base64, " +
          Buffer.from(resp.data.buffer).toString("base64")
        );
      }
      return null;
    },
  );

  return { profile, profileAvatar };
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
      .deleteFrom("book")
      .where("authorDid", "=", agent.assertDid)
      .execute();
  }

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
        hiveId: book.hiveId,
        status: book.status,
      })
      .onConflict((oc) =>
        oc.column("uri").doUpdateSet({
          indexedAt: new Date().toISOString(),
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

  // Homepage
  app.get(
    "/",
    jsxRenderer(async ({ children }) => {
      const c = useRequestContext();
      const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
      let profile: Profile.Record | null = null;
      let profileAvatar: string | null = null;

      if (agent) {
        ({ profile, profileAvatar } = await getProfile(agent, c.get("ctx")));
      }

      return (
        <Layout title="Book Hive | Profile">
          <Navbar
            profileAvatar={profileAvatar ?? undefined}
            hasProfile={Boolean(profile)}
          />
          {children}
        </Layout>
      );
    }),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);

      const buzzes = await c
        .get("ctx")
        .db.selectFrom("buzz")
        .selectAll()
        .orderBy("indexedAt", "desc")
        .limit(10)
        .execute();

      const myBooks = agent
        ? await c
            .get("ctx")
            .db.selectFrom("book")
            .selectAll()
            .where("authorDid", "=", agent.assertDid)
            .orderBy("indexedAt", "desc")
            .limit(10)
            .execute()
        : undefined;

      const didHandleMap = await c
        .get("ctx")
        .resolver.resolveDidsToHandles(buzzes.map((s) => s.authorDid));

      if (!agent) {
        return c.render(
          <Home latestBuzzes={buzzes} didHandleMap={didHandleMap} />,
        );
      }

      const { profile } = await getProfile(agent, c.get("ctx"));

      return c.render(
        <Home
          latestBuzzes={buzzes}
          didHandleMap={didHandleMap}
          profile={profile ?? undefined}
          myBooks={myBooks}
        />,
      );
    },
  );

  app.get("/refresh-books", async (c) => {
    const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
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

    await refetchBooks({
      agent,
      ctx: c.get("ctx"),
    });

    const books = await c
      .get("ctx")
      .db.selectFrom("book")
      .selectAll()
      .where("authorDid", "=", agent.assertDid)
      .orderBy("indexedAt", "desc")
      .limit(10)
      .execute();

    return c.json(books);
  });

  // Redirect to profile/:handle
  app.get("/profile", async (c) => {
    const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
    if (!agent) {
      return c.html(
        <Layout>
          <Error
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

  app.get(
    "/profile/:handle",
    jsxRenderer(async ({ children }) => {
      const c = useRequestContext();
      const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
      let profile: Profile.Record | null = null;
      let profileAvatar: string | null = null;

      if (agent) {
        ({ profile, profileAvatar } = await getProfile(agent, c.get("ctx")));
      }

      return (
        <Layout title="Book Hive | Profile">
          <Navbar
            profileAvatar={profileAvatar ?? undefined}
            hasProfile={Boolean(profile)}
          />
          {children}
        </Layout>
      );
    }),
    async (c) => {
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
        );
      }

      const profileRecord = await c
        .get("ctx")
        .db.selectFrom("book")
        .selectAll()
        .where("authorDid", "=", did)
        .executeTakeFirst();

      if (!profileRecord) {
        return c.render(
          <Fragment>
            <h1>Profile {handle} not found</h1>
            <p>
              This profile may not exist or has not logged any books on bookhive
            </p>
          </Fragment>,
        );
      }

      const profile = await c
        .get("ctx")
        .kv.get<Profile.Record>(`profile:${did}`);
      const profileAvatar = await c
        .get("ctx")
        .kv.get<string>(`profile:${did}:avatar`);

      const books = await c
        .get("ctx")
        .db.selectFrom("book")
        .selectAll()
        .where("authorDid", "=", did)
        .orderBy("indexedAt", "desc")
        .limit(100)
        .execute();

      const buzzes = await c
        .get("ctx")
        .db.selectFrom("buzz")
        .selectAll()
        .where("authorDid", "=", did)
        .orderBy("indexedAt", "desc")
        .limit(100)
        .execute();

      return c.render(
        <Fragment>
          <ProfilePage
            handle={handle}
            books={books}
            buzzes={buzzes}
            profile={profile}
            profileAvatar={profileAvatar}
          />
        </Fragment>,
      );
    },
  );

  app.get(
    "/books/:id",
    jsxRenderer(({ children }) => {
      return <Layout title="Book Hive | Home">{children}</Layout>;
    }),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
      if (!agent) {
        return c.html(
          <Layout>
            <Error
              message="Invalid Session"
              description="Login to view a book"
              statusCode={401}
            />
          </Layout>,
          401,
        );
      }

      const [{ profile, profileAvatar }, book] = await Promise.all([
        getProfile(agent, c.get("ctx")),
        c.get("ctx").kv.get<BookResult>(`book:${c.req.param("id")}`),
      ]);

      if (!book) {
        return c.html(
          <Layout>
            <Error
              message="Book not found"
              description="The book you are looking for does not exist"
              statusCode={404}
            />
          </Layout>,
          404,
        );
      }

      return c.render(
        <BookInfo
          profile={profile ?? undefined}
          profileAvatar={profileAvatar ?? undefined}
          book={book}
        />,
      );
    },
  );

  app.delete("/books/:id", async (c) => {
    const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
    if (!agent) {
      return c.html(
        <Layout>
          <Error
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
      .db.selectFrom("book")
      .selectAll()
      .where("authorDid", "=", agent.assertDid)
      .where("book.uri", "=", bookUri)
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
      .db.deleteFrom("book")
      .where("authorDid", "=", agent.assertDid)
      .where("book.uri", "=", bookUri)
      .execute();

    return c.json({ success: true, bookId, book: book[0] });
  });

  app.post(
    "/books",
    jsxRenderer(({ children }) => {
      return <Layout title="Book Hive | Home">{children}</Layout>;
    }),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
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

      const { author, title, year, status, hiveId, coverImage } =
        await c.req.parseBody();

      console.log({ author, title, year, status, hiveId, coverImage });

      let coverImageBlobRef: BlobRef | undefined = undefined;
      if (coverImage) {
        const data = await fetch(coverImage as string).then((res) =>
          res.arrayBuffer(),
        );

        const resizedImage = await sharp(data)
          .resize({ width: 800, withoutEnlargement: true })
          .jpeg()
          .toBuffer();
        const uploadResponse = await agent.com.atproto.repo.uploadBlob(
          resizedImage,
          {
            encoding: "image/jpeg",
          },
        );
        if (uploadResponse.success) {
          coverImageBlobRef = uploadResponse.data.blob;
        }
      }
      const rkey = TID.nextStr();
      const record = {
        $type: ids.BuzzBookhiveBook,
        createdAt: new Date().toISOString(),
        author: author as string,
        title: title as string,
        cover: coverImageBlobRef,
        year: year !== undefined ? parseInt(year as string, 10) : undefined,
        status: status as string,
        hiveId: hiveId as string,
      } satisfies Book.Record;

      const validation = Book.validateRecord(record);
      if (!validation.success) {
        if (c.req.header()["accept"] === "application/json") {
          return c.json(
            { error: "Invalid book", message: validation.error.message },
            400,
          );
        }
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
        console.log(record.cover?.ref.toString());

        await c
          .get("ctx")
          .db.insertInto("book")
          .values({
            uri: res.data.uri,
            cid: res.data.cid,
            authorDid: agent.assertDid,
            createdAt: record.createdAt,
            indexedAt: new Date().toISOString(),
            author: record.author,
            title: record.title,
            hiveId: record.hiveId,
            year: record.year,
            status: record.status,
          })
          .execute();

        return c.redirect("/books/" + record.hiveId);
      } catch (err) {
        c.get("ctx").logger.warn({ err }, "failed to write book");
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
    },
  );

  app.post("/buzz", async (c) => {
    const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
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

    const { bookUri, bookCid, hiveId, commentUri, commentCid, stars } =
      await c.req.parseBody();
    const rkey = TID.nextStr();
    const record = {
      $type: ids.BuzzBookhiveBuzz,
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
      hiveId: hiveId as string,
    } satisfies Buzz.Record;

    if (!Buzz.validateRecord(record).success) {
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
        collection: ids.BuzzBookhiveBuzz,
        rkey,
        record,
        validate: false,
      });

      await c
        .get("ctx")
        .db.insertInto("buzz")
        .values({
          uri: res.data.uri,
          cid: res.data.cid,
          authorDid: agent.assertDid,
          bookUri: record.book.uri,
          bookCid: record.book.cid,
          commentUri: record.comment?.uri,
          commentCid: record.comment?.cid,
          hiveId: record.hiveId,
          stars: record.stars,
          createdAt: record.createdAt,
          indexedAt: new Date().toISOString(),
        })
        .execute();

      return c.redirect("/");
    } catch (err) {
      c.get("ctx").logger.warn({ err }, "failed to write record");
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
      const agent = await c.get("ctx").getSessionAgent(c.req.raw, c.res);
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
      const { q, limit, offset, id } = c.req.valid("query");

      if (id) {
        // short-circuit if we have an ID to look up
        const book = await c.get("ctx").kv.get<BookResult>(`book:${id}`);

        return c.json([book].filter(Boolean));
      }

      const bookSearch = await readThroughCache(
        c.get("ctx"),
        `search:${q}`,
        () => findBookDetails(q),
      );

      if (!bookSearch.success) {
        return c.json([]);
      }

      c.get("ctx").kv.setItems(
        bookSearch.data.map((book) => ({
          key: `book:${book.id}`,
          value: book,
        })),
      );

      return c.json(bookSearch.data.slice(offset, offset + limit));
    },
  );
}
