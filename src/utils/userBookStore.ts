/** `user_book` row access, apart from getBook.ts so the follow-up can import it without a cycle. */
import type { SessionClient } from "../auth/client";
import type { BookUtilContext } from "../context";
import { ids } from "../bsky/lexicon";
import type { BookRecordValue, HiveId, UserBook, UserBookRow } from "../types";
import { hydrateUserBook, serializeUserBook } from "./bookProgress";

export async function getUserBook({
  ctx,
  agent,
  hiveId,
}: {
  ctx: Pick<BookUtilContext, "db">;
  agent: Pick<SessionClient, "did">;
  hiveId: HiveId;
}): Promise<UserBook | null> {
  const rawUserBook = await ctx.db
    .selectFrom("user_book")
    .selectAll()
    .where("userDid", "=", agent.did)
    .where("hiveId", "=", hiveId)
    .executeTakeFirst();

  if (!rawUserBook) {
    return null;
  }

  return hydrateUserBook(rawUserBook);
}

export async function updateUserBook({
  ctx,
  userBook,
}: {
  ctx: Pick<BookUtilContext, "db">;
  userBook: UserBook;
}): Promise<void> {
  const row: UserBookRow = serializeUserBook(userBook);
  await ctx.db
    .insertInto("user_book")
    .values(row)
    .onConflict((oc) =>
      oc.column("uri").doUpdateSet((c) => ({
        indexedAt: c.ref("excluded.indexedAt"),
        cid: c.ref("excluded.cid"),
        authors: c.ref("excluded.authors"),
        title: c.ref("excluded.title"),
        hiveId: c.ref("excluded.hiveId"),
        status: c.ref("excluded.status"),
        owned: c.ref("excluded.owned"),
        startedAt: c.ref("excluded.startedAt"),
        finishedAt: c.ref("excluded.finishedAt"),
        review: c.ref("excluded.review"),
        stars: c.ref("excluded.stars"),
        bookProgress: c.ref("excluded.bookProgress"),
        previousReads: c.ref("excluded.previousReads"),
        record: c.ref("excluded.record"),
      })),
    )
    .execute();
}

/**
 * The PDS record as far as this row knows; null on a pre-025 row. Columns win:
 * some writes (KOSync progress, `owned` from an upload) reach the row before
 * the PDS, and merging against the record alone would revert them.
 */
export function recordFromUserBook(userBook: UserBook): BookRecordValue | null {
  const record = userBook.record;
  if (!record) return null;
  return {
    ...record,
    $type: ids.BuzzBookhiveBook,
    title: userBook.title,
    authors: userBook.authors,
    hiveId: userBook.hiveId,
    createdAt: userBook.createdAt,
    status: userBook.status ?? undefined,
    startedAt: userBook.startedAt ?? undefined,
    finishedAt: userBook.finishedAt ?? undefined,
    review: userBook.review ?? undefined,
    stars: userBook.stars ?? undefined,
    bookProgress: userBook.bookProgress ?? undefined,
    previousReads: userBook.previousReads ?? undefined,
    // The merge defaults unset `owned` to true, so a column 0 must not make it false.
    owned: userBook.owned === 1 ? true : record.owned === undefined ? undefined : false,
  };
}

export function userBookFromRecord({
  uri,
  cid,
  userDid,
  record,
}: {
  uri: string;
  cid: string;
  userDid: string;
  record: BookRecordValue;
}): UserBook {
  return {
    uri,
    cid,
    userDid,
    createdAt: record.createdAt,
    authors: record.authors,
    title: record.title,
    indexedAt: new Date().toISOString(),
    hiveId: record.hiveId as HiveId,
    status: record.status || null,
    owned: record.owned ? 1 : 0,
    startedAt: record.startedAt || null,
    finishedAt: record.finishedAt || null,
    review: record.review || null,
    stars: record.stars || null,
    bookProgress: record.bookProgress ?? null,
    previousReads: record.previousReads ?? null,
    record,
  };
}
