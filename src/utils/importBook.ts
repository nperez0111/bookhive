import type { BookIdentifiers } from "../types";
import type { GoodreadsBook, StorygraphBook } from "./csv";
import { normalizeGoodreadsId } from "./bookIdentifiers";

export function normalizeStr(s: string): string {
  return s?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function mapGoodreadsStatus(
  book: Pick<GoodreadsBook, "dateRead" | "exclusiveShelf">,
): string {
  if (book.dateRead) return "buzz.bookhive.defs#finished";
  if (book.exclusiveShelf === "currently-reading") return "buzz.bookhive.defs#reading";
  return "buzz.bookhive.defs#wantToRead";
}

export function mapStorygraphStatus(book: Pick<StorygraphBook, "readStatus">): string {
  switch (book.readStatus?.toLowerCase()) {
    case "read":
      return "buzz.bookhive.defs#finished";
    case "currently-reading":
      return "buzz.bookhive.defs#reading";
    default:
      return "buzz.bookhive.defs#wantToRead";
  }
}

export function normalizeGoodreadsRating(myRating: number): number | undefined {
  return myRating ? myRating * 2 : undefined;
}

export function normalizeStorygraphRating(starRating: number): number | undefined {
  return starRating ? parseInt(String(starRating * 2)) : undefined;
}

export function mergeGoodreadsIdentifiers(params: {
  bookId: string;
  isbn: string;
  isbn13: string;
  existingIdentifiers: BookIdentifiers;
  hiveBookId: string;
}): { identifiers: BookIdentifiers; changed: boolean } {
  const { bookId, isbn, isbn13, existingIdentifiers, hiveBookId } = params;
  const validGoodreadsId =
    normalizeGoodreadsId(bookId) ||
    (existingIdentifiers.goodreadsId
      ? normalizeGoodreadsId(existingIdentifiers.goodreadsId)
      : null);
  const newIdentifiers: BookIdentifiers = {
    ...existingIdentifiers,
    hiveId: hiveBookId,
    goodreadsId: validGoodreadsId ?? undefined,
    isbn10: isbn || existingIdentifiers.isbn10,
    isbn13: isbn13 || existingIdentifiers.isbn13,
  };
  const changed =
    newIdentifiers.goodreadsId !== existingIdentifiers.goodreadsId ||
    newIdentifiers.isbn10 !== existingIdentifiers.isbn10 ||
    newIdentifiers.isbn13 !== existingIdentifiers.isbn13 ||
    !existingIdentifiers.hiveId;
  return { identifiers: newIdentifiers, changed };
}

export function mergeStorygraphIdentifiers(params: {
  isbn: string;
  existingIdentifiers: BookIdentifiers;
  hiveBookId: string;
}): { identifiers: BookIdentifiers; changed: boolean } {
  const { isbn, existingIdentifiers, hiveBookId } = params;
  if (!isbn) {
    return { identifiers: existingIdentifiers, changed: false };
  }
  const cleanIsbn = isbn.replace(/[-\s]/g, "");
  const newIdentifiers: BookIdentifiers = {
    ...existingIdentifiers,
    hiveId: hiveBookId,
    ...(cleanIsbn.length === 13
      ? { isbn13: cleanIsbn }
      : cleanIsbn.length === 10
        ? { isbn10: cleanIsbn }
        : {}),
  };
  const changed =
    newIdentifiers.isbn10 !== existingIdentifiers.isbn10 ||
    newIdentifiers.isbn13 !== existingIdentifiers.isbn13 ||
    !existingIdentifiers.hiveId;
  return { identifiers: newIdentifiers, changed };
}

type HiveBookInfo = { id: string; title: string; cover: string | null };

export function buildGoodreadsBookRecord(params: {
  book: GoodreadsBook;
  hiveBook: HiveBookInfo;
  existingHiveIds: Set<string>;
}) {
  const { book, hiveBook, existingHiveIds } = params;
  return {
    authors: book.author,
    title: hiveBook.title,
    status: mapGoodreadsStatus(book),
    hiveId: hiveBook.id,
    coverImage: hiveBook.cover ?? undefined,
    finishedAt: book.dateRead?.toISOString() ?? undefined,
    stars: normalizeGoodreadsRating(book.myRating),
    review: book.myReview || undefined,
    owned: book.ownedCopies > 0 ? true : undefined,
    alreadyExists: existingHiveIds.has(hiveBook.id),
  };
}

export function buildStorygraphBookRecord(params: {
  book: StorygraphBook;
  hiveBook: HiveBookInfo;
  existingHiveIds: Set<string>;
}) {
  const { book, hiveBook, existingHiveIds } = params;
  return {
    authors: book.authors,
    title: hiveBook.title,
    status: mapStorygraphStatus(book),
    hiveId: hiveBook.id,
    coverImage: hiveBook.cover ?? undefined,
    finishedAt: book.lastDateRead?.toISOString() ?? undefined,
    stars: normalizeStorygraphRating(book.starRating),
    review: book.review || undefined,
    owned: book.owned ? true : undefined,
    alreadyExists: existingHiveIds.has(hiveBook.id),
  };
}

export function deduplicateUnmatched<T>(
  unmatchedBooks: Array<{ book: T; reason: string }>,
  getTitle: (book: T) => string,
  getAuthor: (book: T) => string,
): Array<{ title: string; author: string }> {
  return Array.from(
    new Map(
      unmatchedBooks.map((b) => [
        `${normalizeStr(getTitle(b.book))}::${normalizeStr(getAuthor(b.book))}`,
        { title: getTitle(b.book), author: getAuthor(b.book) },
      ]),
    ).values(),
  );
}

/**
 * Deduplicates unmatched books and returns aligned failedBooks + failedBookDetails arrays.
 * The client zips these by index, so they must have the same length and order.
 */
export function deduplicateUnmatchedWithDetails<T, D>(
  unmatchedBooks: Array<{ book: T; reason: string }>,
  getTitle: (book: T) => string,
  getAuthor: (book: T) => string,
  toDetails: (entry: { book: T; reason: string }) => D,
): { failedBooks: Array<{ title: string; author: string }>; failedBookDetails: D[] } {
  const bookMap = new Map<string, { title: string; author: string }>();
  const detailsMap = new Map<string, D>();
  for (const entry of unmatchedBooks) {
    const key = `${normalizeStr(getTitle(entry.book))}::${normalizeStr(getAuthor(entry.book))}`;
    bookMap.set(key, { title: getTitle(entry.book), author: getAuthor(entry.book) });
    detailsMap.set(key, toDetails(entry));
  }
  return {
    failedBooks: Array.from(bookMap.values()),
    failedBookDetails: Array.from(detailsMap.values()),
  };
}
