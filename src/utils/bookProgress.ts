import type { BookProgress, BookRecordValue, PreviousRead } from "../types";

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
    bookProgress: row.bookProgress ? JSON.parse(row.bookProgress) : null,
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
