import { sql } from "kysely";

import { BookFields, type Database } from "../db";
import { BOOK_STATUS } from "../constants";
import { hydrateUserBook } from "../core/bookProgress";
import { monthStartIso, yearStartIso } from "../core/readingYear";

/**
 * A signed-in user's own books, as `/home` and the profile shelf list need
 * them. Both used to run inside JSX via `useRequestContext()` — the same
 * structural problem `data/bookDetail.ts` describes: a query no other
 * transport can reach is a query the next transport re-derives.
 */

/**
 * Books in one status. `orderBy` is a parameter because the two shelves
 * `/home` renders legitimately want different keys: **Currently reading** is
 * an activity list sorted by `indexedAt`, **Want to read** is a queue sorted by
 * `createdAt`. Unifying them would make the to-read list reshuffle every time
 * you rated something.
 */
export async function listShelf({
  db,
  userDid,
  status,
  orderBy = "indexedAt",
  limit,
}: {
  db: Database;
  userDid: string;
  status: string;
  orderBy?: "indexedAt" | "createdAt";
  limit?: number;
}) {
  const rows = await db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .where("user_book.userDid", "=", userDid)
    .where("user_book.status", "=", status)
    .orderBy(orderBy === "createdAt" ? "user_book.createdAt" : "user_book.indexedAt", "desc")
    // Tiebreaker, so two rows stamped in the same millisecond do not swap
    // places between two requests.
    .orderBy("user_book.uri", "desc")
    .$if(limit !== undefined, (qb) => qb.limit(limit!))
    .execute();
  return rows.map(hydrateUserBook);
}

/** Every book this user tracks. The profile shelf tabs filter client-side. */
export async function listAllUserBooks({
  db,
  userDid,
  orderBy = "createdAt",
  limit = 10_000,
}: {
  db: Database;
  userDid: string;
  /**
   * `indexedAt` for the profile page (activity order, matching the feed);
   * `createdAt` for the shelf tab list (library view, ordered by when added).
   */
  orderBy?: "indexedAt" | "createdAt";
  limit?: number;
}) {
  const rows = await db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .where("user_book.userDid", "=", userDid)
    .orderBy(orderBy === "indexedAt" ? "user_book.indexedAt" : "user_book.createdAt", "desc")
    .orderBy("user_book.uri", "desc")
    .limit(limit)
    .execute();
  return rows.map(hydrateUserBook);
}

export type ReadingCounts = { totalRead: number; thisMonth: number; thisYear: number };

/**
 * Finished-book counts for the `/home` header, in one pass over the user's
 * rows rather than three.
 */
export async function getReadingCounts({
  db,
  userDid,
  now = new Date(),
}: {
  db: Database;
  userDid: string;
  now?: Date;
}): Promise<ReadingCounts> {
  // UTC boundaries, because `finishedAt` is a UTC ISO string.
  const yearStart = yearStartIso(now.getUTCFullYear());
  const monthStart = monthStartIso(now);

  const row = await db
    .selectFrom("user_book")
    .where("user_book.userDid", "=", userDid)
    .select([
      sql<number>`sum(case when status = ${BOOK_STATUS.FINISHED} then 1 else 0 end)`.as(
        "totalRead",
      ),
      sql<number>`sum(case when status = ${BOOK_STATUS.FINISHED} and "finishedAt" >= ${yearStart} then 1 else 0 end)`.as(
        "thisYear",
      ),
      sql<number>`sum(case when status = ${BOOK_STATUS.FINISHED} and "finishedAt" >= ${monthStart} then 1 else 0 end)`.as(
        "thisMonth",
      ),
    ])
    .executeTakeFirst();

  return {
    totalRead: Number(row?.totalRead) || 0,
    thisMonth: Number(row?.thisMonth) || 0,
    thisYear: Number(row?.thisYear) || 0,
  };
}
