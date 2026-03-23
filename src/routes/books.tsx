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
    const hiveId = c.req.param("hiveId") as HiveId;
    const book = await c
      .get("ctx")
      .db.selectFrom("hive_book")
      .selectAll()
      .where("id", "=", hiveId)
      .limit(1)
      .executeTakeFirst();

    let isbn: string | undefined;
    if (book) {
      const idMap = await c
        .get("ctx")
        .db.selectFrom("book_id_map")
        .select(["isbn13", "isbn"])
        .where("hiveId", "=", hiveId)
        .limit(1)
        .executeTakeFirst();
      isbn = idMap?.isbn13 || idMap?.isbn || undefined;
    }
    endTime(c, "db_fetch_book");

    if (!book) {
      c.status(404);
      return c.render(
        <ErrorPage
          message="Book not found"
          description="The book you are looking for does not exist"
          statusCode={404}
        />,
        { title: "Book Not Found" },
      );
    }

    const forceRefresh = c.req.query("force-refresh") === "true";
    const needsEnrichment =
      forceRefresh ||
      !book.enrichedAt ||
      new Date(book.enrichedAt) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (needsEnrichment) {
      const enrichPromise = enrichBookWithDetailedData(book, c.get("ctx"), {
        force: forceRefresh,
      }).catch((error) => {
        c.get("ctx").addWideEventContext({
          enrichment_failed_book_view: true,
          bookId: book.id,
          error: error instanceof Error ? error.message : (String(error) as string),
        });
      });

      if (forceRefresh) {
        await enrichPromise;
        // Re-fetch the book after enrichment so the page reflects updated data
        const refreshedBook = await c
          .get("ctx")
          .db.selectFrom("hive_book")
          .selectAll()
          .where("id", "=", hiveId)
          .limit(1)
          .executeTakeFirst();
        if (refreshedBook) {
          Object.assign(book, refreshedBook);
        }
      }
    }

    startTime(c, "render_book_page");
    const authors = book.authors.split("\t");
    const reviewId = c.req.query("review-id") ?? undefined;
    const res = c.render(<BookInfo book={book} reviewId={reviewId} />, {
      title: "BookHive | " + book.title,
      image: `${new URL(c.req.url).origin}/og/book/${hiveId}`,
      description: `See ${book.title} by ${authors.join(", ")} on BookHive, a Goodreads alternative built on Blue Sky`,
      ogType: "book",
      ogExtra: (
        <>
          {authors[0] && <meta property="book:author" content={authors[0]} />}
          {isbn && <meta property="book:isbn" content={isbn} />}
        </>
      ),
    } as any);
    endTime(c, "render_book_page");
    endTime(c, "route_get_book");
    return res;
  })
  .delete("/:hiveId", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      c.status(401);
      return c.render(
        <ErrorPage
          message="Invalid Session"
          description="Login to delete a book"
          statusCode={401}
        />,
        { title: "Unauthorized" },
      );
    }
    const hiveId = c.req.param("hiveId") as HiveId;
    startTime(c, "db_fetch_user_book");
    const book = await c
      .get("ctx")
      .db.selectFrom("user_book")
      .selectAll()
      .where("userDid", "=", agent.did)
      .where("hiveId", "=", hiveId)
      .execute();
    endTime(c, "db_fetch_user_book");

    if (book.length === 0) {
      return c.json({ success: false, hiveId, book: null });
    }
    try {
      startTime(c, "pds_delete_book");
      await agent.post("com.atproto.repo.deleteRecord", {
        input: {
          repo: agent.did,
          collection: ids.BuzzBookhiveBook,
          rkey: book[0]!.uri.split("/").at(-1)!,
        },
      });
      endTime(c, "pds_delete_book");
      startTime(c, "db_delete_user_book");
      await c
        .get("ctx")
        .db.deleteFrom("user_book")
        .where("userDid", "=", agent.did)
        .where("uri", "=", book[0]!.uri)
        .execute();
      endTime(c, "db_delete_user_book");

      if (c.req.header()["accept"] === "application/json") {
        return c.json({ success: true, hiveId, book: book[0] });
      }
      const redirectTo = c.req.query("redirect") || `/books/${hiveId}`;
      return c.redirect(redirectTo);
    } catch (e) {
      c.set("requestError", e);
      c.get("ctx").addWideEventContext({
        book_delete: "failed",
        hiveId,
        userDid: agent.did,
        error: (e as Error).message,
      });
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
        owned: z
          .preprocess(
            (val) => val === "on" || val === "true" || val === true || val === "1",
            z.boolean(),
          )
          .optional(),
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
        c.status(401);
      return c.render(
          <ErrorPage
            message="Invalid Session"
            description="Login to add a book"
            statusCode={401}
          />,
          { title: "Unauthorized" },
        );
      }
      const bookLockKey = "book_lock:" + agent.did;
      try {
        const {
          authors,
          title,
          status,
          owned,
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
        } = c.req.valid("form");

        let bookProgress: Record<string, unknown> | undefined;
        if (currentPage || totalPages || currentChapter || totalChapters || percent !== undefined) {
          if (currentPage && totalPages && currentPage > totalPages) {
            throw new Error("Current page cannot exceed total pages");
          }
          if (currentChapter && totalChapters && currentChapter > totalChapters) {
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
          c.status(429);
          return c.render(
            <ErrorPage
              message={`Book ${JSON.stringify(bookLock)} already being added`}
              statusCode={429}
            />,
            { title: "Too Many Requests" },
          );
        }

        try {
          await c.get("ctx").kv.setItem(bookLockKey, hiveId);
          startTime(c, "pds_update_book");
          await updateBookRecord({
            ctx: c.get("ctx"),
            agent,
            hiveId: hiveId as HiveId,
            updates: {
              authors,
              title,
              status,
              owned,
              hiveId,
              coverImage,
              startedAt,
              finishedAt,
              stars,
              review,
              ...(bookProgress ? { bookProgress } : {}),
            } as Partial<BookRecord.Record> & { coverImage?: string },
          });
          endTime(c, "pds_update_book");
        } catch (e) {
          c.set("requestError", e);
          c.get("ctx").addWideEventContext({ write_book: "failed" });
          c.status(500);
          return c.render(
            <ErrorPage
              message="Failed to record book"
              description={"Error: " + (e as Error).message}
              statusCode={500}
            />,
            { title: "Error" },
          );
        } finally {
          await c.get("ctx").kv.del(bookLockKey);
        }
        const redirectTo = c.req.query("redirect") || `/books/${hiveId}`;
        return c.redirect(redirectTo);
      } catch (err) {
        c.set("requestError", err);
        c.get("ctx").addWideEventContext({ write_book: "failed" });
        await c.get("ctx").kv.del(bookLockKey);
        c.status(500);
        return c.render(
          <ErrorPage
            message="Failed to record book"
            description={"Error: " + (err as Error).message}
            statusCode={500}
          />,
          { title: "Error" },
        );
      }
    },
  )
  .get("/:hiveId/comments", async (c) => {
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
      c.status(404);
      return c.render(
        <ErrorPage
          message="Book not found"
          description="The book you are looking for does not exist"
          statusCode={404}
        />,
        { title: "Book Not Found" },
      );
    }
    const reviewId = c.req.query("review-id") ?? undefined;
    return c.render(<CommentsSection book={book} reviewId={reviewId} />, {
      title: "BookHive | Comments " + book.title,
      image: `${new URL(c.req.url).origin}/og/book/${c.req.param("hiveId")}`,
      description: `Comments on ${book.title} by ${book.authors.split("\t").join(", ")} on BookHive, a Goodreads alternative built on Blue Sky`,
    });
  });

export default app;
