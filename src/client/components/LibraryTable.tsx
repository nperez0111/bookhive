import { useMemo, useState, type FC } from "hono/jsx/dom";
import {
  StatusSelect,
  RatingSelect,
  DeleteButton,
  BookCover,
  DateInput,
  STATUS_LABELS,
  updateBook,
  deleteBook,
} from "./bookActions";

type LibraryBook = {
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
};

const FINISHED = "buzz.bookhive.defs#finished";

// --- Desktop row ---

const TableRow: FC<{
  book: LibraryBook;
  onUpdate: (fields: Partial<LibraryBook>) => void;
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
            {book.authors.split("\t").join(", ")}
          </p>
        </div>
      </div>
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <StatusSelect
        status={book.status}
        onChange={(status) => {
          onUpdate({ status });
          void updateBook(book.hiveId, { status });
        }}
      />
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <RatingSelect
        stars={book.stars}
        onChange={(stars) => {
          onUpdate({ stars });
          void updateBook(book.hiveId, { stars });
        }}
      />
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
          <DateInput
            value={book.startedAt}
            onChange={(startedAt) => {
              onUpdate({ startedAt });
              void updateBook(book.hiveId, { startedAt });
            }}
          />
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
          <DateInput
            value={book.finishedAt}
            onChange={(finishedAt) => {
              onUpdate({ finishedAt });
              void updateBook(book.hiveId, { finishedAt });
            }}
          />
        </div>
      </div>
    </td>
    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <DeleteButton
        onDelete={() => {
          onDelete();
          void deleteBook(book.hiveId);
        }}
      />
    </td>
  </tr>
);

// --- Mobile card ---

const MobileCard: FC<{
  book: LibraryBook;
  onUpdate: (fields: Partial<LibraryBook>) => void;
  onDelete: () => void;
}> = ({ book, onUpdate, onDelete }) => (
  <div className="card transition-[box-shadow] duration-150 active:shadow-none">
    <div className="card-body flex gap-3">
      <a href={`/books/${book.hiveId}`} className="flex flex-1 min-w-0 gap-3">
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-sm shadow-sm outline outline-1 outline-black/10 dark:outline-white/10">
          <BookCover src={book.cover || book.thumbnail} alt={`Cover of ${book.title}`} />
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <div className="text-foreground font-semibold text-sm line-clamp-2">{book.title}</div>
          <div className="text-muted-foreground text-xs mt-0.5">
            {book.authors.split("\t").join(", ")}
          </div>
          {book.status && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="badge capitalize">{STATUS_LABELS[book.status] || book.status}</span>
            </div>
          )}
        </div>
      </a>
      <div className="shrink-0 flex flex-col items-stretch" onClick={(e) => e.stopPropagation()}>
        <StatusSelect
          status={book.status}
          onChange={(status) => {
            onUpdate({ status });
            void updateBook(book.hiveId, { status });
          }}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
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
            <DateInput
              value={book.startedAt}
              onChange={(startedAt) => {
                onUpdate({ startedAt });
                void updateBook(book.hiveId, { startedAt });
              }}
            />
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
              onChange={(finishedAt) => {
                onUpdate({ finishedAt });
                void updateBook(book.hiveId, { finishedAt });
              }}
            />
          </div>
        </div>
        <button
          type="button"
          className="mt-1 self-end rounded-md px-2 py-1.5 text-xs text-destructive transition-[color,background-color] duration-150 hover:bg-destructive/10 hover:text-destructive/80 focus:outline-none"
          onClick={() => {
            onDelete();
            void deleteBook(book.hiveId);
          }}
        >
          Remove
        </button>
      </div>
    </div>
  </div>
);

// --- Main component ---

export const LibraryTable: FC<{ initialBooks: LibraryBook[] }> = ({ initialBooks }) => {
  const [books, setBooks] = useState<LibraryBook[]>(initialBooks);

  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      const aIsFinished = a.status === FINISHED;
      const bIsFinished = b.status === FINISHED;
      if (aIsFinished && bIsFinished) {
        if (!a.finishedAt && !b.finishedAt) return 0;
        if (!a.finishedAt) return 1;
        if (!b.finishedAt) return -1;
        return new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime();
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [books]);

  const updateBook_ = (hiveId: string, fields: Partial<LibraryBook>) => {
    setBooks((prev) => prev.map((b) => (b.hiveId === hiveId ? { ...b, ...fields } : b)));
  };

  const deleteBook_ = (hiveId: string) => {
    setBooks((prev) => prev.filter((b) => b.hiveId !== hiveId));
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
      {/* Desktop: table view */}
      <div className="hidden overflow-hidden rounded-xl bg-card shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)] md:block">
        <table className="table w-full table-fixed">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style={{ width: "34%" }}
              >
                Book
              </th>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style={{ width: "14%" }}
              >
                Status
              </th>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style={{ width: "14%", minWidth: "120px" }}
              >
                Rating
              </th>
              <th
                className="px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-foreground"
                style={{ width: "14%" }}
              >
                Dates
              </th>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style={{ width: "8%" }}
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
                onUpdate={(fields) => updateBook_(book.hiveId, fields)}
                onDelete={() => deleteBook_(book.hiveId)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: card view */}
      <div className="space-y-4 md:hidden">
        {sortedBooks.map((book) => (
          <MobileCard
            key={book.hiveId}
            book={book}
            onUpdate={(fields) => updateBook_(book.hiveId, fields)}
            onDelete={() => deleteBook_(book.hiveId)}
          />
        ))}
      </div>
    </>
  );
};
