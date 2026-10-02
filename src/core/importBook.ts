import { BOOK_STATUS, type BookStatus } from "../constants";
import type { BookIdentifiers } from "../types";
import { displayRatingToStars } from "./rating";
import type { GoodreadsBook, StorygraphBook, HardcoverBook } from "./csv";
import { normalizeGoodreadsId } from "../data/bookIdentifiers";

export function normalizeStr(s: string): string {
  return s?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function mapGoodreadsStatus(
  book: Pick<GoodreadsBook, "dateRead" | "exclusiveShelf">,
): BookStatus {
  switch (book.exclusiveShelf?.toLowerCase()) {
    case "read":
      return BOOK_STATUS.FINISHED;
    case "currently-reading":
      return BOOK_STATUS.READING;
    case "to-read":
      return BOOK_STATUS.WANTTOREAD;
    default:
      return book.dateRead ? BOOK_STATUS.FINISHED : BOOK_STATUS.WANTTOREAD;
  }
}

export function mapStorygraphStatus(book: Pick<StorygraphBook, "readStatus">): BookStatus {
  switch (book.readStatus?.toLowerCase()) {
    case "read":
      return BOOK_STATUS.FINISHED;
    case "currently-reading":
      return BOOK_STATUS.READING;
    default:
      return BOOK_STATUS.WANTTOREAD;
  }
}

/** Goodreads and StoryGraph both rate 1–5; `user_book.stars` is 1–10. */
export function normalizeGoodreadsRating(myRating: number): number | undefined {
  return myRating ? displayRatingToStars(myRating) : undefined;
}

export function normalizeStorygraphRating(starRating: number): number | undefined {
  return starRating ? displayRatingToStars(starRating) : undefined;
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

export function mergeHardcoverIdentifiers(params: {
  book: HardcoverBook;
  existingIdentifiers: BookIdentifiers;
  hiveBookId: string;
}): { identifiers: BookIdentifiers; changed: boolean } {
  const { book, existingIdentifiers, hiveBookId } = params;
  const { isbn10, isbn13 } = book;
  const newIdentifiers: BookIdentifiers = {
    ...existingIdentifiers,
    hiveId: hiveBookId,
    ...(isbn10.length === 10 ? { isbn10 } : {}),
    ...(isbn13.length === 13 ? { isbn13 } : {}),
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
  const status = mapGoodreadsStatus(book);
  return {
    authors: book.author,
    title: hiveBook.title,
    status,
    hiveId: hiveBook.id,
    coverImage: hiveBook.cover ?? undefined,
    finishedAt:
      status === BOOK_STATUS.FINISHED ? (book.dateRead?.toISOString() ?? undefined) : undefined,
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
  const status = mapStorygraphStatus(book);
  return {
    authors: book.authors,
    title: hiveBook.title,
    status,
    hiveId: hiveBook.id,
    coverImage: hiveBook.cover ?? undefined,
    finishedAt:
      status === BOOK_STATUS.FINISHED ? (book.lastDateRead?.toISOString() ?? undefined) : undefined,
    stars: normalizeStorygraphRating(book.starRating),
    review: book.review || undefined,
    owned: book.owned ? true : undefined,
    alreadyExists: existingHiveIds.has(hiveBook.id),
  };
}

export function buildHardcoverBookRecord(params: {
  book: HardcoverBook;
  hiveBook: HiveBookInfo;
  existingHiveIds: Set<string>;
}) {
  const { book, hiveBook, existingHiveIds } = params;
  return {
    title: hiveBook.title,
    authors: book.author,
    status: book.status,
    hiveId: hiveBook.id,
    coverImage: hiveBook.cover ?? undefined,
    finishedAt:
      book.status === BOOK_STATUS.FINISHED
        ? (book.dateFinished?.toISOString() ?? undefined)
        : undefined,
    stars: book.rating,
    review: book.review,
    owned: book.owned,
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
