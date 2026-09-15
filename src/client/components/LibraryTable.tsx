import { useMemo, useState, useRef, useEffect, type FC } from "hono/jsx/dom";
import { ABANDONED, FINISHED, READING, WANTTOREAD } from "../../constants";
import { displayAuthors } from "../../core/authors";
import {
  StatusSelect,
  RatingSelect,
  DeleteButton,
  BookCover,
  DateInput,
  STATUS_LABELS,
} from "./bookActions";
import { createLibraryTableStore } from "./libraryTableStore";
import { ProgressMeter } from "../../pages/components/ProgressMeter";

type BookProgressData = {
  percent?: number;
  totalPages?: number;
  currentPage?: number;
  totalChapters?: number;
  currentChapter?: number;
  updatedAt?: string;
} | null;

export type LibraryBook = {
  hiveId: string;
  title: string;
  authors: string;
  cover?: string | null;
  thumbnail?: string | null;
  status: string | null;
  stars: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  owned: number;
  review: string | null;
  bookProgress: BookProgressData;
  totalPages: number | null;
};

type SortKey = "default" | "title" | "status" | "rating" | "date";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = {
  [READING]: 0,
  [WANTTOREAD]: 1,
  [FINISHED]: 2,
  [ABANDONED]: 3,
};

function compareBooks(a: LibraryBook, b: LibraryBook, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case "title":
      cmp = a.title.localeCompare(b.title);
      break;
    case "status": {
      const aOrd = a.status ? (STATUS_ORDER[a.status] ?? 99) : 99;
      const bOrd = b.status ? (STATUS_ORDER[b.status] ?? 99) : 99;
      cmp = aOrd - bOrd;
      if (cmp === 0) cmp = a.title.localeCompare(b.title);
      break;
    }
    case "rating":
      cmp = (a.stars ?? -1) - (b.stars ?? -1);
      break;
    case "date": {
      const aDate = a.finishedAt || a.startedAt;
      const bDate = b.finishedAt || b.startedAt;
      if (!aDate && !bDate) cmp = 0;
      // Undated books sink to the bottom regardless of direction.
      else if (!aDate) return 1;
      else if (!bDate) return -1;
      else cmp = new Date(aDate).getTime() - new Date(bDate).getTime();
      break;
    }
    default: {
      const aIsReading = a.status === READING;
      const bIsReading = b.status === READING;
      if (aIsReading !== bIsReading) return aIsReading ? -1 : 1;

      const aIsFinished = a.status === FINISHED;
      const bIsFinished = b.status === FINISHED;
      if (aIsFinished && bIsFinished) {
        if (!a.finishedAt && !b.finishedAt) return 0;
        if (!a.finishedAt) return 1;
        if (!b.finishedAt) return -1;
        return new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime();
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  }
  return dir === "desc" ? -cmp : cmp;
}

const SortArrow: FC<{ active: boolean; dir: SortDir }> = ({ active, dir }) => (
  <svg
    className={`ml-1 inline-block h-3 w-3 transition-transform ${active ? "text-primary" : "text-muted-foreground/40"}`}
    viewBox="0 0 12 12"
    fill="currentColor"
  >
    {dir === "asc" ? <path d="M6 2L10 8H2L6 2Z" /> : <path d="M6 10L2 4H10L6 10Z" />}
  </svg>
);

// --- Progress input ---

export function pageProgressUpdate(currentPage: string, book: LibraryBook) {
  // An empty field is no change, not page zero.
  if (currentPage.trim() === "") return null;
  const page = Number(currentPage);
  const total = book.bookProgress?.totalPages ?? book.totalPages;
  if (!Number.isSafeInteger(page) || page < 1 || (total && page > total)) return null;
  if (page === book.bookProgress?.currentPage) return null;

  const progress = {
    currentPage: page,
    totalPages: total || undefined,
    percent: total ? Math.round((page / total) * 100) : undefined,
  };
  return {
    fields: {
      bookProgress: { ...book.bookProgress, ...progress, updatedAt: new Date().toISOString() },
    },
    // Let the shared reading lifecycle infer completion; an explicit old status overrides it.
    payload: { bookProgress: progress },
  };
}

const PageInput: FC<{
  book: LibraryBook;
  onUpdate: (fields: Partial<LibraryBook>, payload?: Record<string, unknown>) => void;
}> = ({ book, onUpdate }) => {
  const total = book.bookProgress?.totalPages ?? book.totalPages;
  const [currentPage, setCurrentPage] = useState(String(book.bookProgress?.currentPage ?? ""));

  // Follow progress replacements, including failed optimistic writes rolling back to the same page.
  useEffect(() => {
    setCurrentPage(String(book.bookProgress?.currentPage ?? ""));
  }, [book.bookProgress]);

  const percent =
    book.status === FINISHED
      ? 100
      : currentPage !== "" && total
        ? Math.max(0, Math.min(100, Math.round((Number(currentPage) / total) * 100)))
        : (book.bookProgress?.percent ?? 0);

  const submitProgress = () => {
    const update = pageProgressUpdate(currentPage, book);
    if (update) onUpdate(update.fields, update.payload);
    else setCurrentPage(String(book.bookProgress?.currentPage ?? ""));
  };

  if (book.status === FINISHED) {
    return (
      <div>
        <ProgressMeter percent={100} size="sm" class="mb-1" />
        <span className="text-xs text-green-600 dark:text-green-400">Finished</span>
      </div>
    );
  }

  return (
    <div>
      {percent > 0 && (
        <ProgressMeter percent={percent} size="sm" class="mb-1" barClass="bg-primary" />
      )}
      <div className="flex items-center gap-1">
        <input
          type="number"
          className="w-14 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs tabular-nums text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
          value={currentPage}
          min={1}
          step={1}
          max={total || undefined}
          placeholder="Pg"
          onInput={(e) => setCurrentPage((e.target as HTMLInputElement).value)}
          onBlur={submitProgress}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {total ? (
          <span className="text-xs tabular-nums text-muted-foreground">/ {total}</span>
        ) : null}
      </div>
    </div>
  );
};

// --- Desktop row ---

const TableRow: FC<{
  book: LibraryBook;
  onUpdate: (fields: Partial<LibraryBook>, payload?: Record<string, unknown>) => void;
  onDelete: () => void;
}> = ({ book, onUpdate, onDelete }) => (
  <tr
    className="cursor-pointer transition-[background-color] duration-150 hover:bg-muted/60 active:bg-muted/80"
    onClick={() => (window.location.href = `/books/${book.hiveId}`)}
  >
    <td className="overflow-hidden px-4 py-2">
      <div className="flex items-center space-x-3">
        <div className="h-12 w-8 shrink-0 overflow-hidden rounded-sm shadow-sm outline outline-1 outline-black/10 dark:outline-white/10">
          <BookCover src={book.cover || book.thumbnail} alt={`Cover of ${book.title}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-sm leading-tight font-medium text-foreground">
            {book.title}
          </h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {displayAuthors(book.authors)}
          </p>
        </div>
      </div>
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <StatusSelect status={book.status} onChange={(status) => onUpdate({ status })} />
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <RatingSelect stars={book.stars} onChange={(stars) => onUpdate({ stars })} />
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <PageInput book={book} onUpdate={onUpdate} />
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <svg
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            title="Started"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <DateInput value={book.startedAt} onChange={(startedAt) => onUpdate({ startedAt })} />
        </div>
        <div className="flex items-center gap-1">
          <svg
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            title="Finished"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z"
            />
          </svg>
          <DateInput value={book.finishedAt} onChange={(finishedAt) => onUpdate({ finishedAt })} />
        </div>
      </div>
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <DeleteButton onDelete={onDelete} />
    </td>
  </tr>
);

// --- Mobile card ---

const MobileCard: FC<{
  book: LibraryBook;
  onUpdate: (fields: Partial<LibraryBook>, payload?: Record<string, unknown>) => void;
  onDelete: () => void;
}> = ({ book, onUpdate, onDelete }) => {
  const total = book.bookProgress?.totalPages ?? book.totalPages;
  const currentPage = book.bookProgress?.currentPage;
  const percent =
    book.status === FINISHED
      ? 100
      : currentPage && total
        ? Math.round((currentPage / total) * 100)
        : (book.bookProgress?.percent ?? 0);

  return (
    <div className="card transition-[box-shadow] duration-150 active:shadow-none">
      <div className="card-body flex flex-col gap-4">
        <a href={`/books/${book.hiveId}`} className="flex flex-1 min-w-0 gap-3">
          <div className="h-16 w-12 shrink-0 overflow-hidden rounded-sm shadow-sm outline outline-1 outline-black/10 dark:outline-white/10">
            <BookCover src={book.cover || book.thumbnail} alt={`Cover of ${book.title}`} />
          </div>
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <div className="text-foreground font-semibold text-sm line-clamp-2">{book.title}</div>
            <div className="text-muted-foreground text-xs mt-0.5">
              {displayAuthors(book.authors)}
            </div>
            {book.status && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="badge capitalize">
                  {STATUS_LABELS[book.status] || book.status}
                </span>
                {percent > 0 && book.status !== FINISHED && (
                  <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
                )}
              </div>
            )}
          </div>
        </a>
        <div className="min-w-0 flex flex-col items-stretch" onClick={(e) => e.stopPropagation()}>
          <StatusSelect status={book.status} onChange={(status) => onUpdate({ status })} />
          {book.status === READING && (
            <div className="mt-2">
              <PageInput book={book} onUpdate={onUpdate} />
            </div>
          )}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-1">
              <svg
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                title="Started"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <DateInput value={book.startedAt} onChange={(startedAt) => onUpdate({ startedAt })} />
            </div>
            <div className="flex items-center gap-1">
              <svg
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                title="Finished"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <DateInput
                value={book.finishedAt}
                onChange={(finishedAt) => onUpdate({ finishedAt })}
              />
            </div>
          </div>
          <button
            type="button"
            className="mt-1 self-end rounded-md px-2 py-1.5 text-xs text-destructive transition-[color,background-color] duration-150 hover:bg-destructive/10 hover:text-destructive/80 focus:outline-none"
            onClick={() => {
              onDelete();
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Main component ---

export const LibraryTable: FC<{ initialBooks: LibraryBook[] }> = ({ initialBooks }) => {
  const [books, setBooks] = useState<LibraryBook[]>(initialBooks);
  const [error, setError] = useState<string | null>(null);
  const storeRef = useRef<ReturnType<typeof createLibraryTableStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createLibraryTableStore(initialBooks, (nextBooks, nextError) => {
      setBooks(nextBooks);
      setError(nextError);
    });
  }
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Rating and date start highest/newest first; text columns start A-Z.
      setSortDir(key === "rating" || key === "date" ? "desc" : "asc");
    }
  };

  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => compareBooks(a, b, sortKey, sortDir));
  }, [books, sortKey, sortDir]);

  const save = (
    book: LibraryBook,
    fields: Partial<LibraryBook>,
    payload?: Record<string, unknown>,
  ) => {
    void storeRef.current!.save(book.hiveId, fields, payload);
  };
  const remove = (book: LibraryBook) => {
    void storeRef.current!.remove(book.hiveId);
  };

  if (!books.length) {
    return (
      <div className="rounded-xl bg-card px-6 py-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]">
        <p className="text-lg text-muted-foreground" style={{ textWrap: "balance" }}>
          No books in your library yet. Start adding books to see them here!
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p
          role="status"
          className="border-destructive/30 bg-destructive/10 text-destructive mb-3 rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
      {/* Desktop: table view */}
      <div className="hidden overflow-hidden rounded-xl bg-card shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)] md:block">
        <table className="table w-full table-fixed">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th
                className="cursor-pointer select-none px-4 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
                style={{ width: "30%" }}
                onClick={() => toggleSort("title")}
              >
                Book
                <SortArrow
                  active={sortKey === "title"}
                  dir={sortKey === "title" ? sortDir : "asc"}
                />
              </th>
              <th
                className="cursor-pointer select-none px-4 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
                style={{ width: "13%" }}
                onClick={() => toggleSort("status")}
              >
                Status
                <SortArrow
                  active={sortKey === "status"}
                  dir={sortKey === "status" ? sortDir : "asc"}
                />
              </th>
              <th
                className="cursor-pointer select-none px-4 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
                style={{ width: "13%", minWidth: "120px" }}
                onClick={() => toggleSort("rating")}
              >
                Rating
                <SortArrow
                  active={sortKey === "rating"}
                  dir={sortKey === "rating" ? sortDir : "asc"}
                />
              </th>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style={{ width: "12%" }}
              >
                Progress
              </th>
              <th
                className="cursor-pointer select-none px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-foreground transition-colors hover:text-primary"
                style={{ width: "14%" }}
                onClick={() => toggleSort("date")}
              >
                Dates
                <SortArrow active={sortKey === "date"} dir={sortKey === "date" ? sortDir : "asc"} />
              </th>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style={{ width: "6%" }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {sortedBooks.map((book) => (
              <TableRow
                key={book.hiveId}
                book={book}
                onUpdate={(fields, payload) => save(book, fields, payload)}
                onDelete={() => remove(book)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: card view */}
      <div className="space-y-4 md:hidden">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Sort by</label>
          <select
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = (e.target as HTMLSelectElement).value.split(":") as [SortKey, SortDir];
              setSortKey(k);
              setSortDir(d);
            }}
          >
            <option value="default:asc">Recent</option>
            <option value="title:asc">Title A-Z</option>
            <option value="title:desc">Title Z-A</option>
            <option value="status:asc">Status</option>
            <option value="rating:desc">Rating high-low</option>
            <option value="rating:asc">Rating low-high</option>
            <option value="date:desc">Date read</option>
          </select>
        </div>
      </div>
      <div className="space-y-4 md:hidden">
        {sortedBooks.map((book) => (
          <MobileCard
            key={book.hiveId}
            book={book}
            onUpdate={(fields, payload) => save(book, fields, payload)}
            onDelete={() => remove(book)}
          />
        ))}
      </div>
    </>
  );
};
