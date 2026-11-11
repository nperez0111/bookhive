import { BOOK_STATUS } from "../constants";
import { displayAuthors, primaryAuthor } from "../../src/core/authors";

export { displayAuthors } from "../../src/core/authors";

export type TrackedFilter =
  | "all"
  | "reading"
  | "wantToRead"
  | "finished"
  | "abandoned"
  | "noStatus"
  | "owned";
export type TrackedSort = "title" | "author" | "dateAdded" | "dateRead" | "rating";
export type SortDirection = "asc" | "desc";

export const TRACKED_FILTERS: { key: TrackedFilter; label: string }[] = [
  { key: "all", label: "All books" },
  { key: "reading", label: "Reading" },
  { key: "wantToRead", label: "Want to read" },
  { key: "finished", label: "Finished" },
  { key: "abandoned", label: "Abandoned" },
  { key: "noStatus", label: "No status" },
  { key: "owned", label: "Owned" },
];

export const TRACKED_SORTS: { key: TrackedSort; label: string }[] = [
  { key: "dateAdded", label: "Date added" },
  { key: "dateRead", label: "Date read" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "rating", label: "Your rating" },
];

type TrackedBook = {
  hiveId: string;
  title?: string | null;
  authors?: string | null;
  status?: string | null;
  owned?: boolean | null;
  createdAt?: string | null;
  finishedAt?: string | null;
  stars?: number | null;
};

const FILTER_STATUS = {
  reading: BOOK_STATUS.READING,
  wantToRead: BOOK_STATUS.WANTTOREAD,
  finished: BOOK_STATUS.FINISHED,
  abandoned: BOOK_STATUS.ABANDONED,
};

export function matchesTrackedFilter(book: TrackedBook, filter: TrackedFilter): boolean {
  if (filter === "all") return true;
  if (filter === "owned") return book.owned === true;
  if (filter === "noStatus") return !book.status;
  return book.status === FILTER_STATUS[filter];
}

export function trackedStatusLabel(status: string | null | undefined): string {
  const filter = Object.entries(FILTER_STATUS).find(([, value]) => value === status)?.[0];
  return TRACKED_FILTERS.find(({ key }) => key === filter)?.label ?? "No status";
}

function timestamp(value: string | null | undefined): number | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

function sortValue(book: TrackedBook, sort: TrackedSort): string | number | null {
  switch (sort) {
    case "title":
      return book.title?.trim().toLocaleLowerCase() || null;
    case "author":
      return primaryAuthor(book.authors).toLocaleLowerCase() || null;
    case "dateAdded":
      return timestamp(book.createdAt);
    // Date read means completion, not a start date or the latest feed activity.
    case "dateRead":
      return timestamp(book.finishedAt);
    case "rating":
      return book.stars != null && Number.isFinite(book.stars) && book.stars > 0
        ? book.stars
        : null;
  }
}

/** Local management of all tracked books, never the paginated ebook-file library. */
export function selectTrackedBooks<T extends TrackedBook>(
  books: readonly T[],
  {
    filter = "all",
    query = "",
    sort = "dateAdded",
    direction = "desc",
  }: {
    filter?: TrackedFilter;
    query?: string;
    sort?: TrackedSort;
    direction?: SortDirection;
  } = {},
): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return books
    .filter((book) => {
      if (!matchesTrackedFilter(book, filter)) return false;
      const text = `${book.title ?? ""} ${displayAuthors(book.authors)}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      // Missing/invalid values stay last in both directions.
      if (av === null && bv !== null) return 1;
      if (av !== null && bv === null) return -1;
      const comparison = av === bv ? 0 : av! < bv! ? -1 : 1;
      return comparison * (direction === "asc" ? 1 : -1) || a.hiveId.localeCompare(b.hiveId);
    });
}
