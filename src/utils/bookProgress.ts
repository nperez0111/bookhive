import type { BookProgress } from "../types";

export function hydrateUserBook<T extends { bookProgress: string | null }>(
  row: T,
): Omit<T, "bookProgress"> & { bookProgress: BookProgress | null } {
  return {
    ...row,
    bookProgress: row.bookProgress ? JSON.parse(row.bookProgress) : null,
  };
}

export function serializeUserBook<
  T extends { bookProgress: BookProgress | null },
>(book: T): Omit<T, "bookProgress"> & { bookProgress: string | null } {
  return {
    ...book,
    bookProgress: book.bookProgress ? JSON.stringify(book.bookProgress) : null,
  };
}
