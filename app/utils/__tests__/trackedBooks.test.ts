import { BOOK_STATUS } from "../../constants";
import {
  displayAuthors,
  matchesTrackedFilter,
  selectTrackedBooks,
  trackedStatusLabel,
} from "../trackedBooks";

const books = [
  {
    hiveId: "bk_c",
    title: "The Left Hand of Darkness",
    authors: "Ursula K. Le Guin\t Another Writer",
    status: BOOK_STATUS.READING,
    owned: true,
    createdAt: "2024-01-01",
    stars: 9,
  },
  {
    hiveId: "bk_b",
    title: "A Wizard of Earthsea",
    authors: "Ursula K. Le Guin",
    status: BOOK_STATUS.FINISHED,
    finishedAt: "2025-06-01",
    createdAt: "2025-01-01",
    stars: 10,
  },
  {
    hiveId: "bk_a",
    title: "Dune",
    authors: "Herbert, Frank",
    status: BOOK_STATUS.WANTTOREAD,
    owned: false,
    createdAt: "2025-01-01",
  },
  {
    hiveId: "bk_d",
    title: "Other",
    authors: "Other Author",
    status: BOOK_STATUS.ABANDONED,
    owned: true,
    createdAt: "not-a-date",
    stars: 0,
  },
  { hiveId: "bk_e", title: "Unsorted", authors: "", status: null },
  { hiveId: "bk_f", title: "Rating only", authors: "", stars: 6 },
];
const ids = (result: { hiveId: string }[]) => result.map((book) => book.hiveId);

describe("tracked book selection", () => {
  it("keeps every tracked record, including owned-only, rating-only and no-status records", () => {
    expect(selectTrackedBooks(books)).toHaveLength(6);
    expect(ids(selectTrackedBooks(books, { filter: "noStatus" }))).toEqual(["bk_e", "bk_f"]);
    expect(matchesTrackedFilter({ hiveId: "bk_owned", owned: true }, "noStatus")).toBe(true);
    expect(matchesTrackedFilter({ hiveId: "bk_unknown", status: "unknown" }, "noStatus")).toBe(
      false,
    );
  });

  it.each([
    ["reading", ["bk_c"]],
    ["wantToRead", ["bk_a"]],
    ["finished", ["bk_b"]],
    ["abandoned", ["bk_d"]],
    ["owned", ["bk_c", "bk_d"]],
  ] as const)("filters %s independently", (filter, expected) => {
    expect(ids(selectTrackedBooks(books, { filter }))).toEqual([...expected]);
  });

  it("matches case-insensitive title and every author, and combines query with status", () => {
    expect(ids(selectTrackedBooks(books, { query: "  DARKNESS    another  " }))).toEqual(["bk_c"]);
    expect(selectTrackedBooks(books, { query: "le guin", filter: "finished" })).toHaveLength(1);
    expect(selectTrackedBooks(books, { query: "dune", filter: "owned" })).toEqual([]);
    expect(selectTrackedBooks(books, { query: "   " })).toHaveLength(6);
    expect(selectTrackedBooks([], { query: "anything" })).toEqual([]);
  });

  it("formats tab authors without splitting a surname comma", () => {
    expect(displayAuthors(" Le Guin, Ursula \t\t Another Writer ")).toBe(
      "Le Guin, Ursula, Another Writer",
    );
    expect(displayAuthors(null)).toBe("");
    expect(trackedStatusLabel(BOOK_STATUS.WANTTOREAD)).toBe("Want to read");
    expect(trackedStatusLabel(undefined)).toBe("No status");
  });

  it("sorts title, first author and rating with stable hiveId ties", () => {
    expect(ids(selectTrackedBooks(books, { sort: "title", direction: "asc" }))).toEqual([
      "bk_b",
      "bk_a",
      "bk_d",
      "bk_f",
      "bk_c",
      "bk_e",
    ]);
    expect(ids(selectTrackedBooks(books, { sort: "author", direction: "asc" }))).toEqual([
      "bk_a",
      "bk_d",
      "bk_b",
      "bk_c",
      "bk_e",
      "bk_f",
    ]);
    expect(ids(selectTrackedBooks(books, { sort: "rating", direction: "desc" }))).toEqual([
      "bk_b",
      "bk_c",
      "bk_f",
      "bk_a",
      "bk_d",
      "bk_e",
    ]);
    expect(ids(selectTrackedBooks(books, { sort: "rating", direction: "asc" }))).toEqual([
      "bk_f",
      "bk_c",
      "bk_b",
      "bk_a",
      "bk_d",
      "bk_e",
    ]);
  });

  it("sorts true date added, not indexedAt, with invalid or missing dates last", () => {
    const withActivity = books.map((book) => ({
      ...book,
      indexedAt: book.hiveId === "bk_c" ? "2099-01-01" : "2000-01-01",
    }));
    expect(ids(selectTrackedBooks(withActivity))).toEqual([
      "bk_a",
      "bk_b",
      "bk_c",
      "bk_d",
      "bk_e",
      "bk_f",
    ]);
    expect(ids(selectTrackedBooks(withActivity, { direction: "asc" }))).toEqual([
      "bk_c",
      "bk_a",
      "bk_b",
      "bk_d",
      "bk_e",
      "bk_f",
    ]);
  });

  it("date read means completion; does not substitute startedAt", () => {
    const dated = [
      { hiveId: "bk_a", startedAt: "2099-01-01" },
      { hiveId: "bk_b", finishedAt: "2024-01-01" },
      { hiveId: "bk_c", finishedAt: "invalid" },
      { hiveId: "bk_d", finishedAt: "2025-01-01" },
    ];
    expect(ids(selectTrackedBooks(dated, { sort: "dateRead" }))).toEqual([
      "bk_d",
      "bk_b",
      "bk_a",
      "bk_c",
    ]);
    expect(ids(selectTrackedBooks(dated, { sort: "dateRead", direction: "asc" }))).toEqual([
      "bk_b",
      "bk_d",
      "bk_a",
      "bk_c",
    ]);
  });

  it("never mutates the source array and is stable regardless of input order", () => {
    const source = [...books];
    const selected = selectTrackedBooks(source);
    expect(source).toEqual(books);
    expect(selected).not.toBe(source);
    expect(ids(selectTrackedBooks([...source].reverse()))).toEqual(ids(selected));
  });

  it("keeps blank text and non-finite ratings last in either direction", () => {
    const sparse = [
      { hiveId: "bk_b", title: "  ", authors: "\t", stars: NaN },
      { hiveId: "bk_a", title: "", stars: Infinity },
      { hiveId: "bk_c", title: "Book", authors: "Author", stars: 5 },
    ];
    for (const direction of ["asc", "desc"] as const) {
      for (const sort of ["title", "author", "rating"] as const) {
        expect(ids(selectTrackedBooks(sparse, { sort, direction }))).toEqual([
          "bk_c",
          "bk_a",
          "bk_b",
        ]);
      }
    }
  });
});
