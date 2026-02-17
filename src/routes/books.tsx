/**
 * Book CRUD and book comments page. Mount at /books.
 * Parent must run methodOverride for /books/:hiveId before mounting this router.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { endTime, startTime } from "hono/timing";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ids, Book as BookRecord } from "../bsky/lexicon";
import { BookInfo } from "../pages/bookInfo";
import { CommentsSection } from "../pages/comments";
import { Error as ErrorPage } from "../pages/error";
import { Layout } from "../pages/layout";
import type { HiveId } from "../types";
import { updateBookRecord } from "../utils/getBook";
import { enrichBookWithDetailedData } from "../utils/enrichBookData";

const app = new Hono<AppEnv>()
  .get("/:hiveId", async (c) => {
    startTime(c, "route_get_book");
    startTime(c, "db_fetch_book");
    const book = await c
      .get("ctx")
      .db.selectFrom("hive_book")
      .selectAll()
      .where("id", "=", c.req.param("hiveId") as HiveId)
      .limit(1)
      .executeTakeFirst();
    endTime(c, "db_fetch_book");

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

    const needsEnrichment =
      !book.enrichedAt ||
      new Date(book.enrichedAt) <
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (needsEnrichment) {
      enrichBookWithDetailedData(book, c.get("ctx")).catch((error) => {
        c.get("ctx").addWideEventContext({
          enrichment_failed_book_view: true,
          bookId: book.id,
          error:
            error instanceof Error ? error.message : (String(error) as string),
        });
      });
    }

    startTime(c, "render_book_page");
    const res = await c.render(<BookInfo book={book} />, {
      title: "BookHive | " + book.title,
      image: `${new URL(c.req.url).origin}/images/s_1190x665,fit_contain,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
      description: `See ${book.title} by ${book.authors.split("\t").join(", ")} on BookHive, a Goodreads alternative built on Blue Sky`,
    });
    endTime(c, "render_book_page");
    endTime(c, "route_get_book");
    return res;
  })
  .delete("/:hiveId", async (c) => {
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
      .where("userDid", "=", agent.did)
      .where("hiveId", "=", hiveId)
      .execute();

    if (book.length === 0) {
      return c.json({ success: false, hiveId, book: null });
    }
    try {
      await agent.post("com.atproto.repo.deleteRecord", {
        input: {
          repo: agent.did,
          collection: ids.BuzzBookhiveBook,
          rkey: book[0].uri.split("/").at(-1)!,
        },
      });
      await c
        .get("ctx")
        .db.deleteFrom("user_book")
        .where("userDid", "=", agent.did)
        .where("uri", "=", book[0].uri)
        .execute();

      if (c.req.header()["accept"] === "application/json") {
        return c.json({ success: true, hiveId, book: book[0] });
      }
      const redirectTo = c.req.query("redirect") || `/books/${hiveId}`;
      return c.redirect(redirectTo);
    } catch (e) {
      console.error("Failed to delete book", e);
      throw e;
    }
  })
  .post(
    "/",
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
      const bookLockKey = "book_lock:" + agent.did;
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

        let bookProgress: Record<string, unknown> | undefined;
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
            } as Partial<BookRecord.Record> & { coverImage?: string },
          });
        } catch (e) {
          c.set("requestError", e);
          c.get("ctx").addWideEventContext({ write_book: "failed" });
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
        c.set("requestError", err);
        c.get("ctx").addWideEventContext({ write_book: "failed" });
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
  )
  .get("/:hiveId/comments", async (c) => {
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

export default app;
