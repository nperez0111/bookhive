import type { BookProgress, PreviousRead } from "../types";

function parseArray(json: string | null): PreviousRead[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as PreviousRead[]) : null;
  } catch {
    return null;
  }
}

export function hydrateUserBook<
  T extends { bookProgress: string | null; previousReads: string | null },
>(
  row: T,
): Omit<T, "bookProgress" | "previousReads"> & {
  bookProgress: BookProgress | null;
  previousReads: PreviousRead[] | null;
} {
  return {
    ...row,
    bookProgress: row.bookProgress ? JSON.parse(row.bookProgress) : null,
    previousReads: parseArray(row.previousReads),
  };
}

export function serializeUserBook<
  T extends { bookProgress: BookProgress | null; previousReads: PreviousRead[] | null },
>(
  book: T,
): Omit<T, "bookProgress" | "previousReads"> & {
  bookProgress: string | null;
  previousReads: string | null;
} {
  return {
    ...book,
    bookProgress: book.bookProgress ? JSON.stringify(book.bookProgress) : null,
    previousReads:
      book.previousReads && book.previousReads.length > 0
        ? JSON.stringify(book.previousReads)
        : null,
  };
}
