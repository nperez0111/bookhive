import type { Book } from "../types";
import { BOOK_STATUS } from "../constants";

/** User stars are 1-10; we display as 1-5 (stars/2). */
const STARS_TO_FIVE = 2;

export type RatingBucket = 1 | 2 | 3 | 4 | 5;

export type ReadingStats = {
  booksCount: number;
  pagesRead: number;
  averageRating: number | null;
  ratingDistribution: Record<RatingBucket, number>;
  topGenres: { genre: string; count: number }[];
  shortestBook: Book | null;
  longestBook: Book | null;
  averagePageCount: number | null;
  mostPopularBook: Book | null;
  leastPopularBook: Book | null;
  /** First book finished in the year (earliest finishedAt) */
  firstBookOfYear: Book | null;
  /** Last book finished in the year (latest finishedAt) */
  lastBookOfYear: Book | null;
};

function getPageCount(book: Book): number | null {
  const fromProgress = book.bookProgress?.totalPages;
  if (fromProgress != null && fromProgress > 0) return fromProgress;
  return null;
}

function starToFive(stars: number): RatingBucket {
  const five = Math.round(stars / STARS_TO_FIVE);
  return Math.min(5, Math.max(1, five)) as RatingBucket;
}

/**
 * Compute reading stats from a list of books, optionally filtered by year.
 * Caller should pass only finished books for the chosen scope (year or all-time)
 * and pre-aggregated genre counts for that same set (e.g. from hive_book_genre query).
 */
export function computeReadingStats(
  books: Book[],
  genreStats: { genre: string; count: number }[],
): ReadingStats {
  const finished = books.length > 0 ? books.filter((b) => b.status === BOOK_STATUS.FINISHED) : [];

  const booksCount = finished.length;

  let pagesRead = 0;
  const booksWithPages: Book[] = [];
  for (const b of finished) {
    const p = getPageCount(b);
    if (p != null) {
      pagesRead += p;
      booksWithPages.push(b);
    }
  }

  const withRating = finished.filter((b): b is Book & { stars: number } =>
    b.stars != null ? true : false,
  );
  const averageRating =
    withRating.length > 0
      ? withRating.reduce((s, b) => s + b.stars, 0) / withRating.length / STARS_TO_FIVE
      : null;

  const ratingDistribution: Record<RatingBucket, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  for (const b of withRating) {
    const bucket = starToFive(b.stars);
    ratingDistribution[bucket]++;
  }

  const topGenres = genreStats.slice(0, 15);

  let shortestBook: Book | null = null;
  let longestBook: Book | null = null;
  if (booksWithPages.length > 0) {
    const byPages = [...booksWithPages].sort(
      (a, b) => (getPageCount(a) ?? 0) - (getPageCount(b) ?? 0),
    );
    shortestBook = byPages[0] ?? null;
    longestBook = byPages[byPages.length - 1] ?? null;
  }
  const averagePageCount =
    booksWithPages.length > 0 ? Math.round(pagesRead / booksWithPages.length) : null;

  const withPopularity = finished.filter(
    (b) => b.rating != null || (b.ratingsCount != null && b.ratingsCount > 0),
  );
  const sortedByPopularity = [...withPopularity].sort((a, b) => {
    const ar = a.rating ?? 0;
    const br = b.rating ?? 0;
    if (br !== ar) return br - ar;
    return (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0);
  });
  const mostPopularBook = sortedByPopularity[0] ?? null;
  const leastPopularBook =
    sortedByPopularity.length > 0
      ? (sortedByPopularity[sortedByPopularity.length - 1] ?? null)
      : null;

  const withFinishedAt = finished.filter(
    (b): b is Book & { finishedAt: string } => b.finishedAt != null,
  );
  const byFinishedAt = [...withFinishedAt].sort(
    (a, b) => new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime(),
  );
  const firstBookOfYear = byFinishedAt[0] ?? null;
  const lastBookOfYear =
    byFinishedAt.length > 0 ? (byFinishedAt[byFinishedAt.length - 1] ?? null) : null;

  return {
    booksCount,
    pagesRead,
    averageRating,
    ratingDistribution,
    topGenres,
    shortestBook,
    longestBook,
    averagePageCount,
    mostPopularBook,
    leastPopularBook,
    firstBookOfYear,
    lastBookOfYear,
  };
}

/**
 * Filter books to finished-in-year for a given year.
 */
export function filterFinishedBooksByYear(books: Book[], year: number): Book[] {
  return books.filter(
    (b) =>
      b.status === BOOK_STATUS.FINISHED &&
      b.finishedAt != null &&
      new Date(b.finishedAt).getFullYear() === year,
  );
}

/**
 * All-time: all finished books.
 */
export function filterFinishedBooksAllTime(books: Book[]): Book[] {
  return books.filter((b) => b.status === BOOK_STATUS.FINISHED);
}

/** Minimum finished books in a year to show full Year in Books (Goodreads-style). */
export const MIN_BOOKS_FOR_YEAR_STATS = 3;
