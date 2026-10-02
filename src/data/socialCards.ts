import { sql } from "kysely";

import type { Database } from "../db";
import { BOOK_STATUS } from "../constants";
import type { HiveId } from "../types";
import { yearStartIso } from "../core/readingYear";

/**
 * The aggregates behind the OG cards (`/og/*`). Kept separate from
 * `profileSummary.ts`/`catalogBooks.ts` because a card asks a different
 * question — a handful of headline numbers and a few cover URLs, not a page of
 * rows — so reusing a page's listing query would mean fetching many books to
 * render a handful of covers.
 *
 * Uncached here deliberately: every one of these sits behind Cloudflare with a
 * long TTL. See the "No server-side OG cache" note in AGENTS.md before adding one.
 */

/** Cover columns, in the order the card renderer prefers them. */
type CoverRow = { cover: string | null; thumbnail: string | null };

export async function getBookCardStats({
  db,
  hiveId,
}: {
  db: Database;
  hiveId: HiveId;
}): Promise<{ readerCount: number }> {
  const row = await db
    .selectFrom("user_book")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("hiveId", "=", hiveId)
    .executeTakeFirst();
  return { readerCount: Number(row?.count ?? 0) };
}

/**
 * The profile card's headline numbers, in one round of queries.
 *
 * `currentlyReading` is the single most recent Reading title — the card shows
 * one, so it fetches one.
 */
export async function getProfileCardStats({
  db,
  did,
  now = new Date(),
}: {
  db: Database;
  did: string;
  now?: Date;
}): Promise<{
  totalBooks: number;
  booksThisYear: number;
  currentlyReading: string | null;
  covers: CoverRow[];
  genres: { genre: string; count: number }[];
}> {
  const yearStart = yearStartIso(now.getUTCFullYear());

  const [totalRow, yearRow, readingRow, covers, genreRows] = await Promise.all([
    db
      .selectFrom("user_book")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("userDid", "=", did)
      .executeTakeFirst(),
    // Re-reads count, matching `/profile/:handle` and `core/readingYear.ts`.
    // `json_valid` guards a malformed `previousReads` blob the same way
    // `hydrateUserBook` does on the JS side.
    db
      .selectFrom("user_book")
      .select(
        sql<number>`
          SUM(
            (CASE WHEN status = ${BOOK_STATUS.FINISHED} AND "finishedAt" >= ${yearStart}
                  THEN 1 ELSE 0 END)
            + (SELECT COUNT(*)
                 FROM json_each(user_book."previousReads")
                WHERE json_valid(user_book."previousReads")
                  AND json_extract(value, '$.finishedAt') >= ${yearStart})
          )
        `.as("count"),
      )
      .where("userDid", "=", did)
      .executeTakeFirst(),
    db
      .selectFrom("user_book")
      .select(["title"])
      .where("userDid", "=", did)
      .where("status", "=", BOOK_STATUS.READING)
      .orderBy("indexedAt", "desc")
      .orderBy("uri", "desc")
      .executeTakeFirst(),
    db
      .selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(["hive_book.cover", "hive_book.thumbnail"])
      .where("user_book.userDid", "=", did)
      .orderBy("user_book.indexedAt", "desc")
      .orderBy("user_book.uri", "desc")
      .limit(10)
      .execute(),
    db
      .selectFrom("hive_book_genre")
      .innerJoin("user_book", "hive_book_genre.hiveId", "user_book.hiveId")
      .select(["hive_book_genre.genre", sql<number>`COUNT(*)`.as("count")])
      .where("user_book.userDid", "=", did)
      .groupBy("hive_book_genre.genre")
      .orderBy(sql`COUNT(*)`, "desc")
      // Tiebreaker so a card doesn't reshuffle between two renders of the same URL.
      .orderBy("hive_book_genre.genre", "asc")
      .limit(5)
      .execute(),
  ]);

  return {
    totalBooks: Number(totalRow?.count ?? 0),
    booksThisYear: Number(yearRow?.count ?? 0),
    currentlyReading: readingRow?.title ?? null,
    covers,
    genres: genreRows.map((r) => ({ genre: r.genre, count: Number(r.count) })),
  };
}

/**
 * The author card. Unlike the `/authors/:author` listing, the count joins
 * `hive_book` rather than counting `hive_book_author` alone — this card renders
 * covers from the joined rows, so a mapping row whose book is gone would make
 * the total disagree with what is drawn.
 */
export async function getAuthorCardStats({
  db,
  author,
  coverLimit = 6,
}: {
  db: Database;
  author: string;
  coverLimit?: number;
}): Promise<{ totalBooks: number; avgRating: number | null; covers: CoverRow[] }> {
  const byAuthor = () =>
    db
      .selectFrom("hive_book")
      .innerJoin("hive_book_author", "hive_book_author.hiveId", "hive_book.id")
      .where("hive_book_author.author", "=", author);

  const [totalRow, avgRow, covers] = await Promise.all([
    byAuthor()
      .select((eb) => eb.fn.countAll().as("count"))
      .executeTakeFirst(),
    byAuthor()
      .select(sql<number>`AVG(rating)`.as("avg"))
      .where("rating", "is not", null)
      .executeTakeFirst(),
    byAuthor()
      .select(["hive_book.cover", "hive_book.thumbnail"])
      .orderBy("hive_book.ratingsCount", "desc")
      .orderBy("hive_book.id", "asc")
      .limit(coverLimit)
      .execute(),
  ]);

  return {
    totalBooks: Number(totalRow?.count ?? 0),
    avgRating: avgRow?.avg ?? null,
    covers,
  };
}

/** The genre card: how many books carry it, and how many people read them. */
export async function getGenreCardStats({
  db,
  genre,
  coverLimit = 6,
}: {
  db: Database;
  genre: string;
  coverLimit?: number;
}): Promise<{ totalBooks: number; readerCount: number; covers: CoverRow[] }> {
  const [totalRow, readerRow, covers] = await Promise.all([
    db
      .selectFrom("hive_book_genre")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("genre", "=", genre)
      .executeTakeFirst(),
    db
      .selectFrom("user_book")
      .innerJoin("hive_book_genre", "user_book.hiveId", "hive_book_genre.hiveId")
      .select(sql<number>`COUNT(DISTINCT user_book.userDid)`.as("count"))
      .where("hive_book_genre.genre", "=", genre)
      .executeTakeFirst(),
    db
      .selectFrom("hive_book")
      .innerJoin("hive_book_genre", "hive_book.id", "hive_book_genre.hiveId")
      .select(["hive_book.cover", "hive_book.thumbnail"])
      .where("hive_book_genre.genre", "=", genre)
      .orderBy("hive_book.ratingsCount", "desc")
      .orderBy("hive_book.id", "asc")
      .limit(coverLimit)
      .execute(),
  ]);

  return {
    totalBooks: Number(totalRow?.count ?? 0),
    readerCount: Number(readerRow?.count ?? 0),
    covers,
  };
}
