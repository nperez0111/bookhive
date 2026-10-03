import { expect, test } from "bun:test";
import {
  defaultBookView,
  filterLibraryBooks,
  pageProgressUpdate,
  type LibraryBook,
} from "./LibraryTable";
import { READING, ABANDONED, FINISHED } from "../../constants";

const book: LibraryBook = {
  hiveId: "bk_test",
  title: "Progress test",
  authors: "Test Author",
  status: READING,
  stars: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  owned: 0,
  review: null,
  bookProgress: { currentPage: 66, totalPages: 658, percent: 10 },
  totalPages: 658,
};

test("workspace defaults to cards through 1200px and table above it", () => {
  expect(defaultBookView(390)).toBe("grid");
  expect(defaultBookView(1200)).toBe("grid");
  expect(defaultBookView(1201)).toBe("table");
  expect(defaultBookView(1920)).toBe("table");
});

test("library filters match title or tab-separated authors without hiding abandoned or status-less books", () => {
  const books = [
    book,
    { ...book, hiveId: "bk_abandoned", status: ABANDONED, authors: "First Author\tSecond Writer" },
    { ...book, hiveId: "bk_none", status: null },
  ];
  expect(filterLibraryBooks(books, "", "all")).toHaveLength(3);
  expect(filterLibraryBooks(books, " SECOND writer ", "all").map((b) => b.hiveId)).toEqual([
    "bk_abandoned",
  ]);
  expect(filterLibraryBooks(books, "progress TEST", READING)).toEqual([book]);
  expect(filterLibraryBooks(books, "", ABANDONED)).toHaveLength(1);
  expect(filterLibraryBooks(books, "", "none").map((b) => b.hiveId)).toEqual(["bk_none"]);
  expect(filterLibraryBooks(books, "", FINISHED)).toEqual([]);
  expect(books).toHaveLength(3);
});

test("library progress sends completion without an old explicit status", () => {
  const update = pageProgressUpdate("658", book);
  expect(update?.payload).toEqual({
    bookProgress: { currentPage: 658, totalPages: 658, percent: 100 },
  });
  expect(update?.fields.bookProgress.currentPage).toBe(658);
});

test("library progress preserves exact page counts when percent rounds up", () => {
  expect(pageProgressUpdate("657", book)?.payload.bookProgress).toEqual({
    currentPage: 657,
    totalPages: 658,
    percent: 100,
  });
});

test("library progress rejects empty, unchanged, fractional, negative and out-of-range input", () => {
  for (const value of [
    "",
    "  ",
    "66",
    "0",
    "-1",
    "1.5",
    "659",
    "NaN",
    "Infinity",
    "9007199254740992",
  ]) {
    expect(pageProgressUpdate(value, book)).toBeNull();
  }
});

test("library progress supports books without a known page count", () => {
  const unknownLength = { ...book, bookProgress: null, totalPages: null };
  expect(pageProgressUpdate("12", unknownLength)?.payload.bookProgress).toEqual({
    currentPage: 12,
    totalPages: undefined,
    percent: undefined,
  });
});
