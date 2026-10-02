/**
 * The viewer's relationship to one book. Every book-state write returns it
 * and the read answers with it, so a client can reconcile without a page
 * re-render. Excludes `userDid` and the raw PDS `record` (blob refs).
 */
import type { BookProgress, HiveId, PreviousRead, UserBook } from "../types";

export type UserBookView = {
  uri: string;
  cid: string;
  hiveId: HiveId;
  title: string;
  authors: string;
  status: string | null;
  owned: boolean;
  stars: number | null;
  review: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  bookProgress: BookProgress | null;
  previousReads: PreviousRead[] | null;
  createdAt: string;
  indexedAt: string;
};

export function toUserBookView(userBook: UserBook): UserBookView {
  return {
    uri: userBook.uri,
    cid: userBook.cid,
    hiveId: userBook.hiveId,
    title: userBook.title,
    authors: userBook.authors,
    status: userBook.status ?? null,
    owned: userBook.owned === 1,
    stars: userBook.stars ?? null,
    review: userBook.review ?? null,
    startedAt: userBook.startedAt ?? null,
    finishedAt: userBook.finishedAt ?? null,
    bookProgress: userBook.bookProgress ?? null,
    previousReads: userBook.previousReads ?? null,
    createdAt: userBook.createdAt,
    indexedAt: userBook.indexedAt,
  };
}
