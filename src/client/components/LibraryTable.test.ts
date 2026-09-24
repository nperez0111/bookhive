import { expect, test } from "bun:test";
import { pageProgressUpdate, type LibraryBook } from "./LibraryTable";
import { READING } from "../../constants";

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
