import { describe, it, expect } from "bun:test";
import type { GoodreadsBook, StorygraphBook } from "./csv";
import type { BookIdentifiers } from "../types";
import {
  normalizeStr,
  mapGoodreadsStatus,
  mapStorygraphStatus,
  normalizeGoodreadsRating,
  normalizeStorygraphRating,
  mergeGoodreadsIdentifiers,
  mergeStorygraphIdentifiers,
  buildGoodreadsBookRecord,
  buildStorygraphBookRecord,
  deduplicateUnmatched,
  deduplicateUnmatchedWithDetails,
} from "./importBook";

// --- Helpers ---

function makeGoodreadsBook(overrides: Partial<GoodreadsBook> = {}): GoodreadsBook {
  return {
    bookId: "12345",
    title: "Test Book",
    author: "Test Author",
    authorLastFirst: "Author, Test",
    additionalAuthors: [],
    isbn: "",
    isbn13: "",
    myRating: 0,
    averageRating: 4.0,
    publisher: "Publisher",
    binding: "Paperback",
    numberOfPages: 300,
    yearPublished: 2024,
    originalPublicationYear: 2024,
    dateRead: null,
    dateAdded: new Date("2024-01-01"),
    bookshelves: [],
    bookshelvesWithPositions: "",
    exclusiveShelf: "to-read",
    myReview: "",
    spoiler: false,
    privateNotes: "",
    readCount: 0,
    ownedCopies: 0,
    ...overrides,
  };
}

function makeStorygraphBook(overrides: Partial<StorygraphBook> = {}): StorygraphBook {
  return {
    title: "Test Book",
    authors: "Test Author",
    contributors: "",
    isbn: "",
    format: "paperback",
    readStatus: "to-read",
    dateAdded: new Date("2024-01-01"),
    lastDateRead: null,
    datesRead: "",
    readCount: 0,
    moods: "",
    pace: "",
    characterOrPlot: "",
    strongCharacterDevelopment: "",
    loveableCharacters: "",
    diverseCharacters: "",
    flawedCharacters: "",
    starRating: 0,
    review: "",
    contentWarnings: "",
    contentWarningDescription: "",
    tags: "",
    owned: false,
    ...overrides,
  };
}

// --- Tests ---

describe("importBook utilities", () => {
  describe("normalizeStr", () => {
    it("lowercases and trims", () => {
      expect(normalizeStr("  Hello World  ")).toBe("hello world");
    });

    it("collapses whitespace", () => {
      expect(normalizeStr("hello   world")).toBe("hello world");
    });

    it("normalizes NFKC characters", () => {
      // ﬁ (U+FB01) decomposes to "fi" under NFKC
      expect(normalizeStr("ﬁnding")).toBe("finding");
    });

    it("handles empty string", () => {
      expect(normalizeStr("")).toBe("");
    });
  });

  describe("mapGoodreadsStatus", () => {
    it("returns finished when dateRead is set", () => {
      expect(
        mapGoodreadsStatus({ dateRead: new Date("2024-01-15"), exclusiveShelf: "read" }),
      ).toBe("buzz.bookhive.defs#finished");
    });

    it("returns finished when dateRead is set even if shelf is currently-reading", () => {
      expect(
        mapGoodreadsStatus({ dateRead: new Date("2024-01-15"), exclusiveShelf: "currently-reading" }),
      ).toBe("buzz.bookhive.defs#finished");
    });

    it("returns reading when exclusiveShelf is currently-reading and no dateRead", () => {
      expect(
        mapGoodreadsStatus({ dateRead: null, exclusiveShelf: "currently-reading" }),
      ).toBe("buzz.bookhive.defs#reading");
    });

    it("returns wantToRead when dateRead is null and shelf is to-read", () => {
      expect(
        mapGoodreadsStatus({ dateRead: null, exclusiveShelf: "to-read" }),
      ).toBe("buzz.bookhive.defs#wantToRead");
    });

    it("returns wantToRead when dateRead is null and shelf is empty", () => {
      expect(
        mapGoodreadsStatus({ dateRead: null, exclusiveShelf: "" }),
      ).toBe("buzz.bookhive.defs#wantToRead");
    });
  });

  describe("mapStorygraphStatus", () => {
    it('maps "read" to finished', () => {
      expect(mapStorygraphStatus({ readStatus: "read" })).toBe("buzz.bookhive.defs#finished");
    });

    it('maps "currently-reading" to reading', () => {
      expect(mapStorygraphStatus({ readStatus: "currently-reading" })).toBe(
        "buzz.bookhive.defs#reading",
      );
    });

    it('maps "to-read" to wantToRead', () => {
      expect(mapStorygraphStatus({ readStatus: "to-read" })).toBe(
        "buzz.bookhive.defs#wantToRead",
      );
    });

    it("maps empty string to wantToRead", () => {
      expect(mapStorygraphStatus({ readStatus: "" })).toBe("buzz.bookhive.defs#wantToRead");
    });

    it("is case-insensitive", () => {
      expect(mapStorygraphStatus({ readStatus: "Read" })).toBe("buzz.bookhive.defs#finished");
      expect(mapStorygraphStatus({ readStatus: "Currently-Reading" })).toBe(
        "buzz.bookhive.defs#reading",
      );
    });
  });

  describe("normalizeGoodreadsRating", () => {
    it("doubles the rating", () => {
      expect(normalizeGoodreadsRating(5)).toBe(10);
      expect(normalizeGoodreadsRating(3)).toBe(6);
      expect(normalizeGoodreadsRating(1)).toBe(2);
    });

    it("returns undefined for 0", () => {
      expect(normalizeGoodreadsRating(0)).toBeUndefined();
    });
  });

  describe("normalizeStorygraphRating", () => {
    it("doubles and truncates to integer", () => {
      expect(normalizeStorygraphRating(4.0)).toBe(8);
      expect(normalizeStorygraphRating(3.5)).toBe(7);
      expect(normalizeStorygraphRating(0.5)).toBe(1);
    });

    it("returns undefined for 0", () => {
      expect(normalizeStorygraphRating(0)).toBeUndefined();
    });
  });

  describe("mergeGoodreadsIdentifiers", () => {
    it("sets identifiers from CSV on empty existing", () => {
      const result = mergeGoodreadsIdentifiers({
        bookId: "12345",
        isbn: "0123456789",
        isbn13: "9780123456789",
        existingIdentifiers: {},
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers).toMatchObject({
        hiveId: "bk_abc",
        goodreadsId: "12345",
        isbn10: "0123456789",
        isbn13: "9780123456789",
      });
      expect(result.changed).toBe(true);
    });

    it("preserves existing when CSV fields are empty", () => {
      const existing: BookIdentifiers = {
        hiveId: "bk_abc",
        isbn10: "0123456789",
        isbn13: "9780123456789",
        goodreadsId: "99999",
      };
      const result = mergeGoodreadsIdentifiers({
        bookId: "99999",
        isbn: "",
        isbn13: "",
        existingIdentifiers: existing,
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers.isbn10).toBe("0123456789");
      expect(result.identifiers.isbn13).toBe("9780123456789");
      expect(result.changed).toBe(false);
    });

    it("reports changed=false when nothing differs", () => {
      const existing: BookIdentifiers = {
        hiveId: "bk_abc",
        goodreadsId: "12345",
        isbn10: "0123456789",
        isbn13: "9780123456789",
      };
      const result = mergeGoodreadsIdentifiers({
        bookId: "12345",
        isbn: "0123456789",
        isbn13: "9780123456789",
        existingIdentifiers: existing,
        hiveBookId: "bk_abc",
      });
      expect(result.changed).toBe(false);
    });

    it("reports changed=true when hiveId was missing", () => {
      const result = mergeGoodreadsIdentifiers({
        bookId: "12345",
        isbn: "",
        isbn13: "",
        existingIdentifiers: { goodreadsId: "12345" },
        hiveBookId: "bk_abc",
      });
      expect(result.changed).toBe(true);
    });

    it("falls back to existing goodreadsId when bookId is invalid", () => {
      const result = mergeGoodreadsIdentifiers({
        bookId: "kca://book/amzn1.something",
        isbn: "",
        isbn13: "",
        existingIdentifiers: { hiveId: "bk_abc", goodreadsId: "99999" },
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers.goodreadsId).toBe("99999");
    });
  });

  describe("mergeStorygraphIdentifiers", () => {
    it("assigns 13-digit ISBN to isbn13", () => {
      const result = mergeStorygraphIdentifiers({
        isbn: "9780316217590",
        existingIdentifiers: {},
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers.isbn13).toBe("9780316217590");
      expect(result.identifiers.isbn10).toBeUndefined();
      expect(result.changed).toBe(true);
    });

    it("assigns 10-digit ISBN to isbn10", () => {
      const result = mergeStorygraphIdentifiers({
        isbn: "0316217590",
        existingIdentifiers: {},
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers.isbn10).toBe("0316217590");
      expect(result.identifiers.isbn13).toBeUndefined();
      expect(result.changed).toBe(true);
    });

    it("strips dashes and spaces before checking length", () => {
      const result = mergeStorygraphIdentifiers({
        isbn: "978-0-316-21759-0",
        existingIdentifiers: {},
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers.isbn13).toBe("9780316217590");
    });

    it("does not set isbn for non-standard lengths", () => {
      const result = mergeStorygraphIdentifiers({
        isbn: "12345678",
        existingIdentifiers: {},
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers.isbn10).toBeUndefined();
      expect(result.identifiers.isbn13).toBeUndefined();
    });

    it("returns unchanged for empty isbn", () => {
      const existing: BookIdentifiers = { hiveId: "bk_abc", isbn13: "9780316217590" };
      const result = mergeStorygraphIdentifiers({
        isbn: "",
        existingIdentifiers: existing,
        hiveBookId: "bk_abc",
      });
      expect(result.identifiers).toEqual(existing);
      expect(result.changed).toBe(false);
    });
  });

  describe("buildGoodreadsBookRecord", () => {
    const hiveBook = { id: "bk_abc", title: "The Book Title", cover: "https://img.example/cover.jpg" };

    it("builds a full record for a read book", () => {
      const book = makeGoodreadsBook({
        dateRead: new Date("2024-06-15"),
        myRating: 4,
        myReview: "Loved it",
        ownedCopies: 1,
      });
      const result = buildGoodreadsBookRecord({
        book,
        hiveBook,
        existingHiveIds: new Set(),
      });
      expect(result).toMatchObject({
        authors: "Test Author",
        title: "The Book Title",
        status: "buzz.bookhive.defs#finished",
        hiveId: "bk_abc",
        coverImage: "https://img.example/cover.jpg",
        stars: 8,
        review: "Loved it",
        owned: true,
        alreadyExists: false,
      });
      expect(result.finishedAt).toBe(new Date("2024-06-15").toISOString());
    });

    it("builds a record for an unread book", () => {
      const book = makeGoodreadsBook();
      const result = buildGoodreadsBookRecord({
        book,
        hiveBook,
        existingHiveIds: new Set(),
      });
      expect(result.status).toBe("buzz.bookhive.defs#wantToRead");
      expect(result.finishedAt).toBeUndefined();
      expect(result.stars).toBeUndefined();
      expect(result.owned).toBeUndefined();
      expect(result.review).toBeUndefined(); // empty string → undefined
    });

    it("sets alreadyExists when hiveId is in the set", () => {
      const result = buildGoodreadsBookRecord({
        book: makeGoodreadsBook(),
        hiveBook,
        existingHiveIds: new Set(["bk_abc"]),
      });
      expect(result.alreadyExists).toBe(true);
    });

    it("sets coverImage to undefined when cover is null", () => {
      const result = buildGoodreadsBookRecord({
        book: makeGoodreadsBook(),
        hiveBook: { ...hiveBook, cover: null },
        existingHiveIds: new Set(),
      });
      expect(result.coverImage).toBeUndefined();
    });
  });

  describe("buildStorygraphBookRecord", () => {
    const hiveBook = { id: "bk_xyz", title: "SG Book", cover: "https://img.example/sg.jpg" };

    it("builds a full record for a read book", () => {
      const book = makeStorygraphBook({
        readStatus: "read",
        lastDateRead: new Date("2024-03-10"),
        starRating: 4.5,
        review: "Great book",
        owned: true,
      });
      const result = buildStorygraphBookRecord({
        book,
        hiveBook,
        existingHiveIds: new Set(),
      });
      expect(result).toMatchObject({
        authors: "Test Author",
        title: "SG Book",
        status: "buzz.bookhive.defs#finished",
        hiveId: "bk_xyz",
        coverImage: "https://img.example/sg.jpg",
        stars: 9,
        review: "Great book",
        owned: true,
        alreadyExists: false,
      });
      expect(result.finishedAt).toBe(new Date("2024-03-10").toISOString());
    });

    it("builds a record for a currently-reading book", () => {
      const book = makeStorygraphBook({ readStatus: "currently-reading" });
      const result = buildStorygraphBookRecord({
        book,
        hiveBook,
        existingHiveIds: new Set(),
      });
      expect(result.status).toBe("buzz.bookhive.defs#reading");
    });

    it("returns undefined review for empty review string", () => {
      const book = makeStorygraphBook({ review: "" });
      const result = buildStorygraphBookRecord({
        book,
        hiveBook,
        existingHiveIds: new Set(),
      });
      expect(result.review).toBeUndefined();
    });

    it("truncates fractional ratings with parseInt", () => {
      const book = makeStorygraphBook({ starRating: 3.5 });
      const result = buildStorygraphBookRecord({
        book,
        hiveBook,
        existingHiveIds: new Set(),
      });
      expect(result.stars).toBe(7);
    });
  });

  describe("deduplicateUnmatched", () => {
    it("deduplicates books with same normalized title and author", () => {
      const books = [
        { book: { title: "The Book", author: "Author Name" }, reason: "no_match" },
        { book: { title: "the book", author: "author name" }, reason: "no_match" },
        { book: { title: "  THE  BOOK  ", author: "  AUTHOR  NAME  " }, reason: "processing_error" },
      ];
      const result = deduplicateUnmatched(books, (b) => b.title, (b) => b.author);
      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe("  THE  BOOK  ");
      expect(result[0]!.author).toBe("  AUTHOR  NAME  ");
    });

    it("keeps books with different authors separate", () => {
      const books = [
        { book: { title: "The Book", author: "Author A" }, reason: "no_match" },
        { book: { title: "The Book", author: "Author B" }, reason: "no_match" },
      ];
      const result = deduplicateUnmatched(books, (b) => b.title, (b) => b.author);
      expect(result).toHaveLength(2);
    });

    it("returns empty array for empty input", () => {
      const result = deduplicateUnmatched([], (b: any) => b.title, (b: any) => b.author);
      expect(result).toHaveLength(0);
    });
  });

  describe("deduplicateUnmatchedWithDetails", () => {
    it("produces aligned failedBooks and failedBookDetails arrays", () => {
      const books = [
        { book: { title: "Book A", author: "Author 1" }, reason: "no_match" },
        { book: { title: "Book B", author: "Author 2" }, reason: "no_match" },
        { book: { title: "book a", author: "author 1" }, reason: "processing_error" },
      ];
      const result = deduplicateUnmatchedWithDetails(
        books,
        (b) => b.title,
        (b) => b.author,
        (entry) => ({ title: entry.book.title, reason: entry.reason }),
      );
      expect(result.failedBooks).toHaveLength(2);
      expect(result.failedBookDetails).toHaveLength(2);
      // Both arrays have same order — Book A then Book B
      expect(result.failedBooks[0]!.title).toBe("book a"); // last win
      expect(result.failedBooks[1]!.title).toBe("Book B");
      // Details align by index
      expect(result.failedBookDetails[0]!.reason).toBe("processing_error"); // last win
      expect(result.failedBookDetails[1]!.reason).toBe("no_match");
    });

    it("returns empty arrays for empty input", () => {
      const result = deduplicateUnmatchedWithDetails(
        [] as Array<{ book: { title: string; author: string }; reason: string }>,
        (b) => b.title,
        (b) => b.author,
        (entry) => ({ title: entry.book.title }),
      );
      expect(result.failedBooks).toHaveLength(0);
      expect(result.failedBookDetails).toHaveLength(0);
    });
  });
});

/**
 * Integration test: real Goodreads CSV rows → parsed → business logic
 *
 * Uses rows from a real Goodreads export covering:
 *   - currently-reading with no rating (Onyx Storm)
 *   - to-read with no ISBN (Rain of Shadows) — unmatched
 *   - read with rating=5 and dateRead, already in library (Kingdom of Ash)
 *   - read with rating=3 and null cover (A Sorceress Comes to Call)
 *   - to-read with additional authors, no ISBN (Inkheart)
 */
describe("Goodreads import integration", () => {
  // Real CSV from a Goodreads export (header + 5 rows)
  const CSV = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
209439446,"Onyx Storm (The Empyrean, #3)",Rebecca Yarros,"Yarros, Rebecca",,"=""1649374186""","=""9781649374189""",0,4.23,Red Tower Books,Hardcover,527,2025,2025,,2024/07/31,currently-reading,currently-reading (#1),currently-reading,,,,1,0
123349658,"Rain of Shadows and Endings (Legacy, #1)",Melissa K. Roehrich,"Roehrich, Melissa K.",,"=""""","=""""",0,4.01,,Kindle Edition,670,2023,2023,,2025/05/12,to-read,to-read (#107),to-read,,,,0,0
76715522,"Kingdom of Ash (Throne of Glass, #7)",Sarah J. Maas,"Maas, Sarah J.",,"=""1639731067""","=""9781639731060""",5,4.71,Bloomsbury Publishing,Hardcover,984,2023,2018,2025/03/05,2025/02/17,,,read,,,,1,0
195790847,A Sorceress Comes to Call,T. Kingfisher,"Kingfisher, T.",,"=""1250244072""","=""9781250244079""",3,4.08,Tor Books,Hardcover,327,2024,2024,2025/04/14,2024/07/21,,,read,,,,1,0
28194,"Inkheart (Inkworld, #1)",Cornelia Funke,"Funke, Cornelia",Anthea Bell,"=""""","=""""",0,3.92,Scholastic Paperbacks,Paperback,563,2005,2003,,2025/04/14,to-read,to-read (#104),to-read,,,,0,0`;

  // Simulated hive_book DB rows — Rain of Shadows has no match
  const hiveBookDb: Record<string, { id: string; title: string; cover: string | null; identifiers: string | null }> = {
    "Onyx Storm (The Empyrean, #3)::Rebecca Yarros": {
      id: "bk_onyxstorm123",
      title: "Onyx Storm",
      cover: "https://covers.example/onyx.jpg",
      identifiers: null,
    },
    "Kingdom of Ash (Throne of Glass, #7)::Sarah J. Maas": {
      id: "bk_kingdomash456",
      title: "Kingdom of Ash",
      cover: "https://covers.example/koa.jpg",
      identifiers: null,
    },
    "A Sorceress Comes to Call::T. Kingfisher": {
      id: "bk_sorceress789",
      title: "A Sorceress Comes to Call",
      cover: null,
      identifiers: null,
    },
    "Inkheart (Inkworld, #1)::Cornelia Funke": {
      id: "bk_inkheart012",
      title: "Inkheart",
      cover: "https://covers.example/inkheart.jpg",
      identifiers: null,
    },
  };

  // Kingdom of Ash already exists in user's library
  const existingHiveIds = new Set(["bk_kingdomash456"]);

  async function parseCsv() {
    const { getGoodreadsCsvParser } = await import("./csv");
    const parser = getGoodreadsCsvParser();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(CSV));
        controller.close();
      },
    });
    const books: import("./csv").GoodreadsBook[] = [];
    const reader = stream.pipeThrough(parser).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      books.push(value);
    }
    return books;
  }

  it("parses all 5 rows from real CSV", async () => {
    const books = await parseCsv();
    expect(books).toHaveLength(5);
    expect(books.map((b) => b.title)).toEqual([
      "Onyx Storm (The Empyrean, #3)",
      "Rain of Shadows and Endings (Legacy, #1)",
      "Kingdom of Ash (Throne of Glass, #7)",
      "A Sorceress Comes to Call",
      "Inkheart (Inkworld, #1)",
    ]);
  });

  it("processes the full pipeline: parse → match → merge identifiers → build record", async () => {
    const books = await parseCsv();
    const unmatchedBooks: Array<{ book: import("./csv").GoodreadsBook; reason: string }> = [];
    const results: Array<{ hiveId: string; record: ReturnType<typeof buildGoodreadsBookRecord> }> = [];

    for (const book of books) {
      const key = `${book.title}::${book.author}`;
      const hiveBook = hiveBookDb[key];

      if (!hiveBook) {
        unmatchedBooks.push({ book, reason: "no_match" });
        continue;
      }

      const existingIdentifiers: BookIdentifiers = hiveBook.identifiers
        ? JSON.parse(hiveBook.identifiers)
        : {};

      mergeGoodreadsIdentifiers({
        bookId: book.bookId,
        isbn: book.isbn,
        isbn13: book.isbn13,
        existingIdentifiers,
        hiveBookId: hiveBook.id,
      });

      const record = buildGoodreadsBookRecord({ book, hiveBook, existingHiveIds });
      results.push({ hiveId: hiveBook.id, record });
    }

    // 4 matched, 1 unmatched
    expect(results).toHaveLength(4);
    expect(unmatchedBooks).toHaveLength(1);
    expect(unmatchedBooks[0]!.book.title).toBe("Rain of Shadows and Endings (Legacy, #1)");
    expect(unmatchedBooks[0]!.reason).toBe("no_match");

    // Onyx Storm: currently-reading on Goodreads → reading (exclusiveShelf driven)
    const onyx = results.find((r) => r.hiveId === "bk_onyxstorm123")!;
    expect(onyx.record).toMatchObject({
      authors: "Rebecca Yarros",
      title: "Onyx Storm",
      status: "buzz.bookhive.defs#reading",
      hiveId: "bk_onyxstorm123",
      coverImage: "https://covers.example/onyx.jpg",
      alreadyExists: false,
    });
    expect(onyx.record.stars).toBeUndefined();
    expect(onyx.record.finishedAt).toBeUndefined();

    // Kingdom of Ash: read, rating=5 → stars=10, already exists
    const koa = results.find((r) => r.hiveId === "bk_kingdomash456")!;
    expect(koa.record).toMatchObject({
      authors: "Sarah J. Maas",
      title: "Kingdom of Ash",
      status: "buzz.bookhive.defs#finished",
      stars: 10,
      coverImage: "https://covers.example/koa.jpg",
      alreadyExists: true,
    });
    // Date parsed from "2025/03/05" — exact ISO depends on local timezone
    expect(koa.record.finishedAt).toBeDefined();
    expect(new Date(koa.record.finishedAt!).getFullYear()).toBe(2025);
    expect(new Date(koa.record.finishedAt!).getMonth()).toBe(2); // March = 2

    // A Sorceress Comes to Call: read, rating=3 → stars=6, null cover
    const sorceress = results.find((r) => r.hiveId === "bk_sorceress789")!;
    expect(sorceress.record).toMatchObject({
      authors: "T. Kingfisher",
      title: "A Sorceress Comes to Call",
      status: "buzz.bookhive.defs#finished",
      stars: 6,
      alreadyExists: false,
    });
    expect(sorceress.record.coverImage).toBeUndefined();
    expect(sorceress.record.finishedAt).toBeDefined();
    expect(new Date(sorceress.record.finishedAt!).getFullYear()).toBe(2025);
    expect(new Date(sorceress.record.finishedAt!).getMonth()).toBe(3); // April = 3

    // Inkheart: to-read, no ISBN, has additional authors
    const inkheart = results.find((r) => r.hiveId === "bk_inkheart012")!;
    expect(inkheart.record).toMatchObject({
      authors: "Cornelia Funke",
      title: "Inkheart",
      status: "buzz.bookhive.defs#wantToRead",
      coverImage: "https://covers.example/inkheart.jpg",
      alreadyExists: false,
    });
    expect(inkheart.record.stars).toBeUndefined();
    expect(inkheart.record.finishedAt).toBeUndefined();
  });

  it("merges identifiers correctly for books with and without ISBNs", async () => {
    const books = await parseCsv();

    // Onyx Storm: has bookId, isbn, isbn13
    const onyxBook = books.find((b) => b.title.startsWith("Onyx Storm"))!;
    const onyxResult = mergeGoodreadsIdentifiers({
      bookId: onyxBook.bookId,
      isbn: onyxBook.isbn,
      isbn13: onyxBook.isbn13,
      existingIdentifiers: {},
      hiveBookId: "bk_onyxstorm123",
    });
    expect(onyxResult.identifiers).toEqual({
      hiveId: "bk_onyxstorm123",
      goodreadsId: "209439446",
      isbn10: "1649374186",
      isbn13: "9781649374189",
    });
    expect(onyxResult.changed).toBe(true);

    // Inkheart: has bookId but no isbn/isbn13
    const inkheartBook = books.find((b) => b.title.startsWith("Inkheart"))!;
    const inkheartResult = mergeGoodreadsIdentifiers({
      bookId: inkheartBook.bookId,
      isbn: inkheartBook.isbn,
      isbn13: inkheartBook.isbn13,
      existingIdentifiers: {},
      hiveBookId: "bk_inkheart012",
    });
    expect(inkheartResult.identifiers).toEqual({
      hiveId: "bk_inkheart012",
      goodreadsId: "28194",
    });
    expect(inkheartResult.changed).toBe(true);
  });

  it("deduplicates failed books from a real import run", async () => {
    const books = await parseCsv();
    // Simulate the same book failing twice (e.g. retry)
    const rainBook = books.find((b) => b.title.startsWith("Rain of Shadows"))!;
    const unmatchedBooks = [
      { book: rainBook, reason: "no_match" },
      { book: rainBook, reason: "processing_error" },
    ];
    const deduped = deduplicateUnmatched(unmatchedBooks, (b) => b.title, (b) => b.author);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual({
      title: "Rain of Shadows and Endings (Legacy, #1)",
      author: "Melissa K. Roehrich",
    });
  });
});
