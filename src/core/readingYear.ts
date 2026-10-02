import { BOOK_STATUS } from "../constants";

/**
 * "How many books did you finish in year N" — asserted once.
 *
 * **Which year** must use the UTC boundary, since `finishedAt` is a UTC ISO
 * string — a local `getFullYear()` only agrees with `Date.UTC` on a `TZ=UTC`
 * host.
 *
 * **Whether a re-read counts**: yes. A re-read is a book you read this year,
 * so `previousReads` entries count alongside the current read.
 */

/** First instant of `year`, as the UTC ISO string `finishedAt` is compared against. */
export function yearStartIso(year: number): string {
  return new Date(Date.UTC(year, 0, 1)).toISOString();
}

/** First instant of the month containing `now`, UTC. */
export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** The UTC year an ISO timestamp falls in, or null when it is absent/unparseable. */
export function utcYearOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const year = new Date(iso).getUTCFullYear();
  return Number.isNaN(year) ? null : year;
}

type CountableRead = {
  status?: string | null;
  finishedAt?: string | null;
  previousReads?: { finishedAt?: string | null }[] | null;
};

/**
 * How many times this book was finished in `year` — 0, 1, or more than 1 when
 * the user read it again. The current read only counts when the book is
 * actually Finished; `previousReads` entries are completed passes by
 * construction (`core/bookLifecycle.ts` only archives one when it has a
 * `finishedAt`), so they count regardless of the book's current status.
 */
export function timesFinishedInYear(book: CountableRead, year: number): number {
  let count = 0;
  if (book.status === BOOK_STATUS.FINISHED && utcYearOf(book.finishedAt) === year) count++;
  for (const read of book.previousReads ?? []) {
    if (utcYearOf(read.finishedAt) === year) count++;
  }
  return count;
}

/** The same count across a shelf. */
export function booksFinishedInYear(books: CountableRead[], year: number): number {
  return books.reduce((sum, book) => sum + timesFinishedInYear(book, year), 0);
}
