/**
 * Libby availability route. Mounted at `/libby`.
 *
 * Loads the signed-in user's want-to-read shelf joined with `book_id_map`
 * so the client-side island has every identifier (ISBN-10/13, OL workId)
 * it needs to query Libby's Thunder API directly from the browser.
 */
import { Hono } from "hono";
import { endTime, startTime } from "hono/timing";

import type { AppEnv } from "../context";
import { BOOK_STATUS } from "../constants";
import { LibbyPage } from "../pages/libby";

const app = new Hono<AppEnv>().get("/", async (c) => {
  const ctx = c.get("ctx");
  const agent = await ctx.getSessionAgent();
  if (!agent) {
    return c.redirect("/login?next=/libby");
  }

  startTime(c, "libby_books");
  const rows = await ctx.db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .leftJoin("book_id_map", "user_book.hiveId", "book_id_map.hiveId")
    .select([
      "user_book.hiveId",
      "user_book.title",
      "user_book.authors",
      "hive_book.cover",
      "hive_book.thumbnail",
      "book_id_map.isbn",
      "book_id_map.isbn13",
      "book_id_map.olWorkId",
    ])
    .where("user_book.userDid", "=", agent.did)
    .where("user_book.status", "=", BOOK_STATUS.WANTTOREAD)
    .orderBy("user_book.indexedAt", "desc")
    .execute();
  endTime(c, "libby_books");

  const books = rows.map((row) => ({
    hiveId: row.hiveId,
    title: row.title,
    author: row.authors.split("\t").filter(Boolean).join(", "),
    cover: row.cover ?? row.thumbnail ?? null,
    isbn: row.isbn,
    isbn13: row.isbn13,
    olWorkId: row.olWorkId,
  }));

  return c.render(<LibbyPage books={books} />, {
    title: "BookHive | Libby Availability",
    description: "Check which of your want-to-read books are available now at your local library.",
  });
});

export default app;
