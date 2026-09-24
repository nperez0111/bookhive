import { sql, type NotNull } from "kysely";

import type { Database } from "../db";
import type { HiveBook, HiveId, UserBookRow } from "../types";

/**
 * Everything `/books/:hiveId` and XRPC `getBook` read.
 *
 * Nothing here renders. A page component's job is to lay out what it was
 * given; deciding which rows those are is this layer's.
 */

/** The viewer's own row for this book, or undefined when signed out. */
export async function getViewerBook({
  db,
  userDid,
  hiveId,
}: {
  db: Database;
  userDid: string | null;
  hiveId: HiveId;
}): Promise<UserBookRow | undefined> {
  if (!userDid) return undefined;
  return await db
    .selectFrom("user_book")
    .selectAll()
    .where("userDid", "=", userDid)
    .where("hiveId", "=", hiveId)
    .executeTakeFirst();
}

/**
 * Who else has this book, newest activity first, plus how many there are in
 * total.
 *
 * `excludeDid` is applied to the **count** but not to the rows: the page needs
 * the viewer's own row present to decide whether they are the only reader, and
 * needs the count to exclude them so "12 others are reading this" is true.
 * Getting that backwards is why the two copies disagreed about whether the
 * total included you.
 */
export async function listBookActivity({
  db,
  hiveId,
  limit,
  excludeDid = null,
}: {
  db: Database;
  hiveId: HiveId;
  limit: number;
  excludeDid?: string | null;
}): Promise<{ rows: UserBookRow[]; othersTotal: number }> {
  const [rows, counted] = await Promise.all([
    db
      .selectFrom("user_book")
      .selectAll()
      .where("hiveId", "=", hiveId)
      // `indexedAt`, matching the feed and the profile — see migration 027.
      .orderBy("indexedAt", "desc")
      .orderBy("uri", "desc")
      .limit(limit)
      .execute(),
    db
      .selectFrom("user_book")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("hiveId", "=", hiveId)
      .$if(excludeDid !== null, (qb) => qb.where("userDid", "!=", excludeDid!))
      .executeTakeFirstOrThrow(),
  ]);
  return { rows, othersTotal: Number(counted.count) };
}

/**
 * How many people have written a review of this book.
 *
 * `review != ''` **and** not null: the page counted only the empty-string case
 * and the XRPC handler only the null case, so the same book reported two
 * different review counts depending on where you looked.
 */
export async function countBookReviews({
  db,
  hiveId,
}: {
  db: Database;
  hiveId: HiveId;
}): Promise<number> {
  const row = await db
    .selectFrom("user_book")
    .select(sql<number>`count(*)`.as("count"))
    .where("hiveId", "=", hiveId)
    .where("review", "is not", null)
    .where("review", "!=", "")
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/** More by the same author, same-language first. Excludes the book itself. */
export async function listOtherBooksByAuthor({
  db,
  author,
  excludeHiveId,
  language,
  limit = 6,
}: {
  db: Database;
  author: string;
  excludeHiveId: HiveId;
  language?: string | null;
  limit?: number;
}): Promise<HiveBook[]> {
  if (!author) return [];
  return await db
    .selectFrom("hive_book")
    .innerJoin("hive_book_author", "hive_book_author.hiveId", "hive_book.id")
    .selectAll("hive_book")
    .where("hive_book.id", "!=", excludeHiveId)
    .where("hive_book_author.author", "=", author)
    .$if(Boolean(language), (qb) =>
      qb.orderBy(sql`CASE WHEN hive_book.language = ${language} THEN 0 ELSE 1 END`, "asc"),
    )
    .orderBy("hive_book.ratingsCount", "desc")
    .orderBy("hive_book.rating", "desc")
    // Unique final key, same rule as every other catalogue listing.
    .orderBy("hive_book.id", "asc")
    .limit(limit)
    .execute();
}

/** The viewer's recorded reading progress for this book, newest first. */
export async function listProgressHistory({
  db,
  userDid,
  hiveId,
  limit = 20,
}: {
  db: Database;
  userDid: string | null;
  hiveId: HiveId;
  limit?: number;
}): Promise<
  {
    currentPage: number | null;
    totalPages: number | null;
    percent: number | null;
    createdAt: string;
  }[]
> {
  if (!userDid) return [];
  return await db
    .selectFrom("progress_history")
    .select(["currentPage", "totalPages", "percent", "createdAt"])
    .where("userDid", "=", userDid)
    .where("hiveId", "=", hiveId)
    .orderBy("createdAt", "desc")
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
}

/**
 * Every shelf that holds this book, across all users.
 *
 * Deliberately **not** filtered to the viewer: `/books/:hiveId` renders both
 * halves — "on 3 other readers' shelves" and "on your shelves" — and partitions
 * this list by `userDid` itself. `userDid` here only decides whether to run the
 * query at all, since a signed-out visitor sees neither section.
 */
export async function listShelvesHoldingBook({
  db,
  userDid,
  hiveId,
}: {
  db: Database;
  /** Signed-out visitors get an empty list; the page renders no shelf section. */
  userDid: string | null;
  hiveId: HiveId;
}): Promise<{ uri: string; name: string; userDid: string; itemUri: string }[]> {
  if (!userDid) return [];
  return await db
    .selectFrom("book_list_item")
    .innerJoin("book_list", "book_list_item.listUri", "book_list.uri")
    .select([
      "book_list.uri",
      "book_list.name",
      "book_list.userDid",
      "book_list_item.uri as itemUri",
    ])
    .where("book_list_item.hiveId", "=", hiveId)
    .execute();
}

/**
 * The two comment sources for a book: reviews written on `user_book`, and
 * free-standing buzzes. `/books/:id/comments` and XRPC `getBook` both need
 * them, with the same limits.
 */
export async function listBookDiscussion({
  db,
  hiveId,
  reviewLimit = 1000,
  buzzLimit = 3000,
}: {
  db: Database;
  hiveId: HiveId;
  reviewLimit?: number;
  buzzLimit?: number;
}) {
  const [reviews, buzzes] = await Promise.all([
    db
      .selectFrom("user_book")
      .select([
        "user_book.review as comment",
        "user_book.createdAt",
        "user_book.stars",
        "user_book.userDid",
        "user_book.uri",
        "user_book.cid",
      ])
      .where("user_book.hiveId", "=", hiveId)
      .where("user_book.review", "is not", null)
      .$narrowType<{ comment: NotNull }>()
      .orderBy("user_book.createdAt", "desc")
      .orderBy("user_book.uri", "desc")
      .limit(reviewLimit)
      .execute(),
    db
      .selectFrom("buzz")
      .select([
        "buzz.comment",
        "buzz.createdAt",
        "buzz.userDid",
        "buzz.parentUri",
        // `bookUri`/`bookCid`/`parentCid` are here for XRPC `getBook`, which
        // publishes them as strongRefs. The page ignores them; carrying three
        // extra columns is cheaper than a second copy of this query, which is
        // what the handler had — without the `uri` tiebreakers below.
        "buzz.parentCid",
        "buzz.bookUri",
        "buzz.bookCid",
        "buzz.cid",
        "buzz.uri",
      ])
      .where("buzz.hiveId", "=", hiveId)
      .orderBy("buzz.createdAt", "desc")
      .orderBy("buzz.uri", "desc")
      .limit(buzzLimit)
      .execute(),
  ]);
  return { reviews, buzzes };
}
