import { expect, test } from "bun:test";
import { jsx } from "hono/jsx/jsx-runtime";
import { LibraryTable } from "../../client/components/LibraryTable";
import { FINISHED, READING, WANTTOREAD } from "../../constants";
import type { Book } from "../../types";
import { compareTrackedBooks } from "../utils/trackedBookOrder";
import { TrackedBooks } from "./TrackedBooks";

const book: Book = {
  hiveId: "bk_test",
  uri: "at://did:plc:test/buzz.bookhive.book/test",
  cid: "test",
  userDid: "did:plc:test",
  title: "A <book>",
  authors: "First Author\tSecond Author",
  status: READING,
  stars: 8,
  startedAt: "2026-10-01T00:00:00.000Z",
  finishedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  indexedAt: "2026-09-01T00:00:00.000Z",
  owned: 0,
  review: null,
  bookProgress: {
    currentPage: 10,
    totalPages: 100,
    percent: 10,
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  previousReads: null,
  record: null,
  cover: null,
  thumbnail: null,
  description: null,
  rating: null,
  ratingsCount: null,
  meta: null,
};

test("first paint includes real linked grid and table content without requiring JavaScript", async () => {
  const markup = (await TrackedBooks({ books: [book] }))?.toString() ?? "";
  expect(markup).toContain("min-[1201px]:hidden");
  expect(markup).toContain("hidden min-[1201px]:block");
  expect(markup).toContain("<fieldset disabled");
  expect(markup).toContain("<noscript>");
  expect(markup).toContain("Open a book to view or edit its details.");
  expect(markup).toContain('<caption class="sr-only">Your library</caption>');
  expect(markup).toContain('href="/books/bk_test"');
  expect(markup).toContain("A &lt;book&gt;");
  expect(markup).toContain(`<option value="${READING}" selected="">`);
  expect(markup).toContain('<option value="8" selected="">');
  expect(markup).toContain('aria-label="Current page"');
  expect(markup).toContain('value="10"');
  expect(markup).not.toContain("<script");
});

test("server and client initial order puts reading first and finished dates newest first", () => {
  const books = [
    { ...book, title: "Older finish", status: FINISHED, finishedAt: "2026-09-01" },
    { ...book, title: "Newer finish", status: FINISHED, finishedAt: "2026-10-01" },
    { ...book, title: "Undated finish", status: FINISHED },
    { ...book, title: "Reading" },
  ];
  expect([...books].sort(compareTrackedBooks).map((b) => b.title)).toEqual([
    "Reading",
    "Newer finish",
    "Older finish",
    "Undated finish",
  ]);
  expect(
    compareTrackedBooks(book, { ...book, status: WANTTOREAD, createdAt: "2026-10-02" }),
  ).toBeLessThan(0);
  expect(books[0]?.title).toBe("Older finish");
});

test("server first-paint table matches the enhanced table markup", async () => {
  const serverMarkup = (await TrackedBooks({ books: [book] }))?.toString() ?? "";
  const enhancedMarkup = await jsx(LibraryTable, {
    initialBooks: [{ ...book, totalPages: 100 }],
    initialView: "table",
  }).toString();
  const tableMarkup = (markup: string) =>
    markup.slice(markup.indexOf("<table"), markup.indexOf("</table>") + "</table>".length);
  expect(tableMarkup(serverMarkup)).toContain('href="/books/bk_test"');
  expect(tableMarkup(serverMarkup)).toBe(tableMarkup(enhancedMarkup));
});
