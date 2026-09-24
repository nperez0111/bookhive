import { ABANDONED, FINISHED, READING } from "../constants";
import type { BookProgress, BookRecordValue, PreviousRead } from "../types";

/**
 * A progress reading is coherent: you cannot be on page 400 of a 300-page book.
 * Returns the offending message, or null — returning rather than throwing lets
 * each write adapter keep its own status code without owning the rule.
 */
export function bookProgressProblem(progress: {
  currentPage?: number | undefined;
  totalPages?: number | undefined;
  currentChapter?: number | undefined;
  totalChapters?: number | undefined;
}): string | null {
  const { currentPage, totalPages, currentChapter, totalChapters } = progress;
  if (currentPage && totalPages && currentPage > totalPages) {
    return "Current page cannot exceed total pages";
  }
  if (currentChapter && totalChapters && currentChapter > totalChapters) {
    return "Current chapter cannot exceed total chapters";
  }
  return null;
}

/**
 * Recording complete progress means Finished; other progress means Reading, unless you have already
 * said otherwise. Finishing a book and *then* syncing a stray page-turn off an
 * e-reader must not reopen it, and neither must abandoning one.
 *
 * Returns the status to assert, or `undefined` to leave it alone.
 */
export function statusFromProgress(
  existingStatus: string | null | undefined,
  progress?: Omit<BookProgress, "updatedAt">,
): string | undefined {
  if (existingStatus === FINISHED || existingStatus === ABANDONED) return undefined;
  // Page/chapter counts are exact; the displayed percent may have rounded up.
  if (progress?.totalPages && progress.currentPage !== undefined) {
    return progress.currentPage === progress.totalPages ? FINISHED : READING;
  }
  if (progress?.totalChapters && progress.currentChapter !== undefined) {
    return progress.currentChapter === progress.totalChapters ? FINISHED : READING;
  }
  if (progress?.percent === 100) return FINISHED;
  return READING;
}

/** The KOReader fraction (0..1) as the lexicon's 0..100 integer percent. */
export function toPercent(fraction: number): number {
  return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}

/**
 * Guards `JSON.parse` so a malformed blob can't throw out of `hydrateUserBook`.
 * An array is rejected too: `JSON.parse("[]")` succeeds and would otherwise
 * hand every reader an array typed as a `BookProgress`.
 */
function parseProgress(json: string | null): BookProgress | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BookProgress)
      : null;
  } catch {
    return null;
  }
}

function parseArray(json: string | null): PreviousRead[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as PreviousRead[]) : null;
  } catch {
    return null;
  }
}

function parseRecord(json: string | null | undefined): BookRecordValue | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as BookRecordValue) : null;
  } catch {
    return null;
  }
}

export function hydrateUserBook<
  T extends { bookProgress: string | null; previousReads: string | null; record?: string | null },
>(
  row: T,
): Omit<T, "bookProgress" | "previousReads" | "record"> & {
  bookProgress: BookProgress | null;
  previousReads: PreviousRead[] | null;
  record: BookRecordValue | null;
} {
  return {
    ...row,
    bookProgress: parseProgress(row.bookProgress),
    previousReads: parseArray(row.previousReads),
    record: parseRecord(row.record),
  };
}

export function serializeUserBook<
  T extends {
    bookProgress: BookProgress | null;
    previousReads: PreviousRead[] | null;
    record: BookRecordValue | null;
  },
>(
  book: T,
): Omit<T, "bookProgress" | "previousReads" | "record"> & {
  bookProgress: string | null;
  previousReads: string | null;
  record: string | null;
} {
  return {
    ...book,
    bookProgress: book.bookProgress ? JSON.stringify(book.bookProgress) : null,
    previousReads:
      book.previousReads && book.previousReads.length > 0
        ? JSON.stringify(book.previousReads)
        : null,
    // CAR-sourced CID objects stringify to `{ $link }` via toJSON, so this is always wire-shaped.
    record: book.record ? JSON.stringify(book.record) : null,
  };
}
