/**
 * Book CRUD and book comments page. Mount at /books.
 * Parent must run methodOverride for /books/:hiveId before mounting this router.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { endTime, startTime } from "hono/timing";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ids, Book as BookRecord } from "../bsky/lexicon";
import { BookInfo } from "../pages/bookInfo";
import { CommentsSection } from "../pages/comments";
import { Error as ErrorPage } from "../pages/error";
import type { HiveId } from "../types";
import { updateBookRecord } from "../utils/getBook";
import { enrichBookWithDetailedData } from "../utils/enrichBookData";
import { enqueueEnrichment } from "../utils/enrichQueue";
import { withTimeout } from "../utils/semaphore";
import { setCacheControl } from "./lib";

/** How long an explicit `?force-refresh=true` will wait before falling back to
 *  the data we already have. */
const FORCE_REFRESH_TIMEOUT_MS = 15_000;

/** Hive ids are `bk_` + base62. Anything else (notably the `/books/null` a
 *  buggy client kept requesting) is a client bug, not a missing book. */
const HIVE_ID_PATTERN = /^bk_[A-Za-z0-9]+$/;

/**
 * Reject a malformed `:hiveId` with a 400 instead of letting it reach the DB.
 * Records the id and referer so the offending caller is identifiable, and sets
 * `no-store` — the surrounding routes set a long public Cache-Control, and a
 * cached 400 would be served to everyone hitting the same bad URL.
 */
function rejectBadHiveId(c: Context<AppEnv>, hiveId: string) {
  c.get("ctx").addWideEventContext({
    bad_hive_id: hiveId,
    referer: c.req.header("referer") ?? null,
  });
  c.header("Cache-Control", "no-store");
  c.status(400);
  return c.render(
    <ErrorPage
      message="Invalid book ID"
      description="That doesn't look like a book identifier"
      statusCode={400}
    />,
    { title: "Invalid book ID" },
  );
}

/** Query params the book page understands. Both optional; unknown params are
 *  ignored (the anon page cache bypasses on anything outside its allowlist). */
const bookPageQuerySchema = z.object({
  "force-refresh": z.string().optional(),
  "review-id": z.string().optional(),
});

const app = new Hono<AppEnv>()
  .get("/:hiveId", zValidator("query", bookPageQuerySchema), async (c) => {
    // Anonymous only — `cacheControl` downgrades a signed-in request to
    // no-store, because the rendered page carries that viewer's navbar/shelf state.
    setCacheControl(c, "public, max-age=3600, stale-while-revalidate=600");
    startTime(c, "route_get_book");
    startTime(c, "db_fetch_book");
    const hiveId = c.req.param("hiveId") as HiveId;

    if (!HIVE_ID_PATTERN.test(hiveId)) return rejectBadHiveId(c, hiveId);
    const [book, idMap] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .selectAll()
        .where("id", "=", hiveId)
        .limit(1)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("book_id_map")
        .select(["isbn13", "isbn"])
        .where("hiveId", "=", hiveId)
        .limit(1)
        .executeTakeFirst(),
    ]);
    const isbn = idMap?.isbn13 || idMap?.isbn || undefined;
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

    const query = c.req.valid("query");
    const forceRefresh = query["force-refresh"] === "true";
    const needsEnrichment =
      !book.enrichedAt ||
      new Date(book.enrichedAt) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (forceRefresh) {
      // Explicit user action, so it stays inline — but bounded. On timeout we
      // render what we already have instead of holding the request open.
      try {
        await withTimeout(
          enrichBookWithDetailedData(book, c.get("ctx"), { force: true }),
          FORCE_REFRESH_TIMEOUT_MS,
          `force refresh ${hiveId}`,
        );
      } catch (error) {
        c.get("ctx").addWideEventContext({
          enrichment_failed_book_view: true,
          bookId: book.id,
          error: error instanceof Error ? error.message : (String(error) as string),
        });
      }
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
    } else if (needsEnrichment) {
      // Queue it — a page view must never wait on (or spawn) a Goodreads scrape.
      await enqueueEnrichment(c.get("ctx").db, hiveId).catch((error) => {
        c.get("ctx").addWideEventContext({
          enrichment_enqueue: "failed",
          bookId: book.id,
          error: error instanceof Error ? error.message : (String(error) as string),
        });
      });
    }

    startTime(c, "render_book_page");
    const authors = book.authors.split("\t");
    const reviewId = query["review-id"];
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
      atTags: { canonical: book.hiveBookAtUri },
    });
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
    if (!HIVE_ID_PATTERN.test(hiveId)) return rejectBadHiveId(c, hiveId);
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
        hiveId: z.string().optional(),
        bookUri: z.string().optional(),
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
          bookUri,
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

        if (!hiveId && !bookUri) {
          c.status(400);
          return c.render(
            <ErrorPage
              message="Missing book identifier"
              description="Either hiveId or bookUri is required."
              statusCode={400}
            />,
            { title: "Bad Request" },
          );
        }

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

        // Check-then-set lock: the KV driver is SQLite-backed and shared
        // across worker processes. Stale locks (>60s) from crashed requests
        // are cleared before checking. The TOCTOU window is narrow and the
        // worst case is a duplicate (idempotent) book update.
        const bookLockMeta = await c.get("ctx").kv.getMeta(bookLockKey);
        if (bookLockMeta?.mtime) {
          const lockAge = Date.now() - new Date(bookLockMeta.mtime).getTime();
          if (lockAge < 60_000) {
            const existingLock = await c.get("ctx").kv.getItem(bookLockKey);
            if (existingLock) {
              c.status(429);
              return c.render(
                <ErrorPage
                  message={`Book ${JSON.stringify(existingLock)} already being added`}
                  statusCode={429}
                />,
                { title: "Too Many Requests" },
              );
            }
          } else {
            await c.get("ctx").kv.removeItem(bookLockKey);
          }
        }

        try {
          await c.get("ctx").kv.setItem(bookLockKey, hiveId ?? bookUri!);
          startTime(c, "pds_update_book");
          await updateBookRecord({
            ctx: c.get("ctx"),
            agent,
            hiveId: hiveId ? (hiveId as HiveId) : undefined,
            bookUri,
            updates: {
              authors,
              title,
              status,
              owned,
              ...(hiveId ? { hiveId } : {}),
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
        let defaultRedirect: string;
        if (hiveId) {
          defaultRedirect = `/books/${hiveId}`;
        } else {
          const handle = (await c.get("ctx").resolver.resolveDidToHandle(agent.did)) ?? agent.did;
          const rkey = bookUri!.split("/").at(-1)!;
          defaultRedirect = `/profile/${handle}/book/${rkey}`;
        }
        const redirectTo = c.req.query("redirect") || defaultRedirect;
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
    // Public, viewer-independent page (CommentsSection is rendered without `did`
    // here), and it reads up to ~1000 reviews + ~3000 buzzes + batched profiles.
    // The surrounding Layout still carries the viewer's navbar, so signed-in
    // requests get no-store.
    setCacheControl(c, "public, max-age=300, stale-while-revalidate=120");
    const commentsHiveId = c.req.param("hiveId") as HiveId;
    if (!HIVE_ID_PATTERN.test(commentsHiveId)) return rejectBadHiveId(c, commentsHiveId);
    startTime(c, "db_fetch_book");
    const book = await c
      .get("ctx")
      .db.selectFrom("hive_book")
      .selectAll()
      .where("id", "=", commentsHiveId)
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
