import { useMemo, useState, useRef, useEffect, type FC } from "hono/jsx/dom";
import { ABANDONED, FINISHED, READING, WANTTOREAD } from "../../constants";
import { displayAuthors } from "../../core/authors";
import { StatusSelect, RatingSelect, DeleteButton, BookCover, DateInput } from "./bookActions";
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
          aria-label="Current page"
          className="min-h-10 w-20 xl:min-h-0 xl:w-14 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs tabular-nums text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
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
            title="Date started"
          >
            <title>Date started</title>
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
            title="Date finished"
          >
            <title>Date finished</title>
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
      <div className="card-body flex flex-col items-start gap-3 sm:flex-row">
        <a href={`/books/${book.hiveId}`} className="flex w-full min-w-0 gap-3 sm:flex-1">
          <div className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-sm shadow-sm outline outline-1 outline-black/10 dark:outline-white/10">
            <BookCover src={book.cover || book.thumbnail} alt={`Cover of ${book.title}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-foreground font-semibold text-sm line-clamp-2">{book.title}</div>
            <div className="text-muted-foreground text-xs mt-0.5">
              {displayAuthors(book.authors)}
            </div>
            {percent > 0 && book.status !== FINISHED && (
              <div className="mt-1 text-xs tabular-nums text-muted-foreground">{percent}% read</div>
            )}
          </div>
        </a>
        <div
          className="flex w-full shrink-0 flex-col items-stretch sm:w-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <StatusSelect status={book.status} onChange={(status) => onUpdate({ status })} />
          {book.status === READING && (
            <div className="mt-2">
              <PageInput book={book} onUpdate={onUpdate} />
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <span>Start date</span>
              <DateInput value={book.startedAt} onChange={(startedAt) => onUpdate({ startedAt })} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <span>End date</span>
              <DateInput
                value={book.finishedAt}
                onChange={(finishedAt) => onUpdate({ finishedAt })}
              />
            </label>
          </div>
          <button
            type="button"
            aria-pressed={!!book.owned}
            className="btn btn-ghost mt-3 min-h-10 w-full"
            onClick={() => onUpdate({ owned: book.owned ? 0 : 1 })}
          >
            <span aria-hidden="true">{book.owned ? "✓" : "+"}</span>
            Owned
          </button>
          <button
            type="button"
            className="focus-ring mt-1 inline-flex min-h-10 min-w-10 items-center justify-center self-end rounded-md px-2 text-xs text-destructive transition-[color,background-color] duration-150 hover:bg-destructive/10 hover:text-destructive/80"
            onClick={onDelete}
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
  const [pendingDelete, setPendingDelete] = useState<LibraryBook | null>(null);
  const [removing, setRemoving] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (pendingDelete) deleteDialog.current?.showModal();
  }, [pendingDelete]);

  const requestDelete = (book: LibraryBook) => {
    setDeleteError(false);
    setPendingDelete(book);
  };
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
  const remove = (book: LibraryBook) => storeRef.current!.remove(book.hiveId);

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
      <dialog
        ref={deleteDialog}
        aria-labelledby="library-remove-title"
        aria-describedby="library-remove-description"
        onClose={() => setPendingDelete(null)}
        onCancel={(event: Event) => {
          if (removing) event.preventDefault();
        }}
        className="fixed top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
      >
        <h3 id="library-remove-title" className="mb-2 text-lg font-semibold">
          Remove book?
        </h3>
        <p id="library-remove-description" className="mb-4 text-sm text-muted-foreground">
          This will remove “{pendingDelete?.title}” from your library. This cannot be undone.
        </p>
        {deleteError && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            Could not remove this book. Please try again.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={removing}
            className="btn btn-ghost min-h-10"
            onClick={() => deleteDialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={removing}
            className="btn btn-destructive min-h-10"
            onClick={async () => {
              if (!pendingDelete || removing) return;
              setRemoving(true);
              setDeleteError(false);
              const ok = await remove(pendingDelete);
              setRemoving(false);
              if (ok) {
                deleteDialog.current?.close();
                setPendingDelete(null);
              } else setDeleteError(true);
            }}
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      </dialog>
      {/* Desktop: table view.
          Bounded scroll container: caps height to the viewport so the header
          pins reliably (sticky resolves against this box's scrollport, not the
          document — the app shell scrolls at document level, and an
          overflow-hidden ancestor here would sink the sticky thead with the
          page). overflow-auto is the safety net for the narrow end.

          `xl`, not `md`. Six columns need ~880px, but this table renders inside
          the app shell's max-w-5xl column *next to the sidebar*: measured
          content width is 476px at a 820px viewport and 632px at 1024px, so
          every width below ~1130px got a table that scrolled sideways. The card
          view below is a better answer for that range than a table you have to
          drag. Note the ceiling is max-w-5xl, not the viewport — content tops
          out at ~976px however wide the screen gets, so the column budget below
          has to fit in that. */}
      <div className="hidden max-h-[calc(100dvh-11rem)] overflow-auto rounded-xl bg-card shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)] xl:block">
        <table className="table w-full min-w-[880px] table-fixed">
          {/* The only accessible name this table has: the visible "Library"
              heading lives in the server-rendered page, outside the island. */}
          <caption className="sr-only">Your library</caption>
          {/* The row scrolling under the pinned header needs an edge to
              disappear behind, or it dissolves into the header fill. */}
          <thead className="sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_var(--border)]">
            <tr>
              <th
                className="cursor-pointer select-none px-4 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
                style={{ width: "29%" }}
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
                style={{ width: "17%" }}
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
                style={{ width: "11%" }}
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
                style={{ width: "13%" }}
              >
                Progress
              </th>
              <th
                className="cursor-pointer select-none px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-foreground transition-colors hover:text-primary"
                style={{ width: "20%" }}
                onClick={() => toggleSort("date")}
              >
                Dates
                <SortArrow active={sortKey === "date"} dir={sortKey === "date" ? sortDir : "asc"} />
              </th>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style={{ width: "10%" }}
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
                onDelete={() => requestDelete(book)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: card view */}
      <div className="space-y-4 xl:hidden">
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
      <div className="space-y-4 xl:hidden">
        {sortedBooks.map((book) => (
          <MobileCard
            key={book.hiveId}
            book={book}
            onUpdate={(fields, payload) => save(book, fields, payload)}
            onDelete={() => requestDelete(book)}
          />
        ))}
      </div>
    </>
  );
};
