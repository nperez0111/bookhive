import { type FC } from "hono/jsx";
import type { Book } from "../../types";
import { BOOK_STATUS } from "../../constants";
import { Card, CardBody, CardActions } from "./cards";
import { BookCard, normalizeBookData } from "./BookCard";

const toDateValue = (date: string | null | undefined) =>
  date ? new Date(date).toISOString().slice(0, 10) : "";

const DateInputForm: FC<{
  book: Book;
  field: "startedAt" | "finishedAt";
  redirectUrl?: string;
}> = ({ book, field, redirectUrl }) => {
  return (
    <form action={`/books${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`} method="post">
      <input type="hidden" name="authors" value={book.authors} />
      <input type="hidden" name="title" value={book.title} />
      <input type="hidden" name="hiveId" value={book.hiveId} />
      {book.cover && <input type="hidden" name="coverImage" value={book.cover} />}
      {book.status && <input type="hidden" name="status" value={book.status} />}
      {book.stars && <input type="hidden" name="stars" value={String(book.stars)} />}
      {book.review && <input type="hidden" name="review" value={book.review} />}
      {field === "startedAt" && book.finishedAt && (
        <input type="hidden" name="finishedAt" value={book.finishedAt} />
      )}
      {field === "finishedAt" && book.startedAt && (
        <input type="hidden" name="startedAt" value={book.startedAt} />
      )}
      <input
        type="date"
        name={field}
        value={toDateValue(field === "startedAt" ? book.startedAt : book.finishedAt)}
        onchange="this.form.submit()"
        class="w-full rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
      />
    </form>
  );
};

const RatingSelect: FC<{
  book: Book;
  redirectUrl?: string;
}> = ({ book, redirectUrl }) => {
  return (
    <form action={`/books${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`} method="post">
      <input type="hidden" name="authors" value={book.authors} />
      <input type="hidden" name="title" value={book.title} />
      <input type="hidden" name="hiveId" value={book.hiveId} />
      {book.cover && <input type="hidden" name="coverImage" value={book.cover} />}
      {book.status && <input type="hidden" name="status" value={book.status} />}
      {book.review && <input type="hidden" name="review" value={book.review} />}
      {book.startedAt && <input type="hidden" name="startedAt" value={book.startedAt} />}
      {book.finishedAt && <input type="hidden" name="finishedAt" value={book.finishedAt} />}
      <select
        name="stars"
        onchange="this.form.submit()"
        class="w-full cursor-pointer rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
      >
        <option value="" selected={!book.stars}>-</option>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
          <option key={val} value={val} selected={book.stars === val}>
            {"★".repeat(Math.floor(val / 2))}
            {val % 2 === 1 ? "½" : ""}
            {" "}
            {(val / 2).toFixed(1)}
          </option>
        ))}
      </select>
    </form>
  );
};

const StatusSelect: FC<{
  book: Book;
  redirectUrl?: string;
}> = ({ book, redirectUrl }) => {
  const statuses = [
    { value: BOOK_STATUS.FINISHED, label: "Read" },
    { value: BOOK_STATUS.READING, label: "Reading" },
    { value: BOOK_STATUS.WANTTOREAD, label: "Want to Read" },
    { value: BOOK_STATUS.ABANDONED, label: "Abandoned" },
  ];

  return (
    <form action={`/books${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`} method="post">
      <input type="hidden" name="authors" value={book.authors} />
      <input type="hidden" name="title" value={book.title} />
      <input type="hidden" name="hiveId" value={book.hiveId} />
      {book.cover && <input type="hidden" name="coverImage" value={book.cover} />}
      {book.stars && <input type="hidden" name="stars" value={String(book.stars)} />}
      {book.review && <input type="hidden" name="review" value={book.review} />}
      {book.startedAt && <input type="hidden" name="startedAt" value={book.startedAt} />}
      {book.finishedAt && <input type="hidden" name="finishedAt" value={book.finishedAt} />}
      <select
        name="status"
        onchange="this.form.submit()"
        class="w-full cursor-pointer rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
      >
        <option value="" selected={!book.status}>Status</option>
        {statuses.map((s) => (
          <option key={s.value} value={s.value} selected={book.status === s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
};

export const EditableLibraryTable: FC<{
  books: Book[];
  redirectUrl?: string;
}> = ({ books, redirectUrl }) => {
  if (!books.length) {
    return (
      <div class="rounded-xl border border-border bg-card px-6 py-8 text-center shadow-sm">
        <p class="text-lg text-muted-foreground">
          No books in your library yet. Start adding books to see them here!
        </p>
      </div>
    );
  }

  // Sort books: finished books by finishedAt DESC, others by createdAt DESC
  const sortedBooks = [...books].sort((a, b) => {
    const aIsFinished = a.status === BOOK_STATUS.FINISHED;
    const bIsFinished = b.status === BOOK_STATUS.FINISHED;

    // If both are finished, sort by finishedAt (most recent first)
    if (aIsFinished && bIsFinished) {
      if (!a.finishedAt && !b.finishedAt) return 0;
      if (!a.finishedAt) return 1;
      if (!b.finishedAt) return -1;
      return new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime();
    }

    // If only one is finished, prioritize based on general creation date
    // This keeps the overall list in a sensible order
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <>
      {/* Desktop: table view */}
      <div class="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
        <table class="table w-full table-fixed">
          <thead class="sticky top-0 z-10 bg-muted">
            <tr>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 34%"
              >
                Book
              </th>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 14%"
              >
                Status
              </th>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 14%; min-width: 120px"
              >
                Rating
              </th>
              <th
                class="px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-foreground"
                style="width: 14%"
              >
                Dates
              </th>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 8%"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border bg-card">
            {sortedBooks.map((book) => (
              <tr
                key={book.hiveId}
                class="cursor-pointer transition-colors duration-150 hover:bg-muted/60"
                onclick={`window.location.href='/books/${book.hiveId}'`}
              >
                <td class="overflow-hidden px-4 py-2">
                  <div class="flex items-center space-x-3">
                    <div class="h-12 w-8 shrink-0 overflow-hidden rounded-md">
                      <img
                        src={book.cover || book.thumbnail || ""}
                        alt={`Cover of ${book.title}`}
                        class="book-cover h-full w-full object-cover"
                        style={`--book-cover-name: book-cover-${book.hiveId}`}
                        onError={(e: any) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = "none";
                          target.nextElementSibling?.classList.remove("hidden");
                        }}
                      />
                      <div class="hidden h-full w-full items-center justify-center bg-linear-to-br from-muted to-card">
                        <svg class="h-6 w-6 text-primary" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    </div>
                    <div class="min-w-0 flex-1">
                      <h3
                        class="book-title line-clamp-1 text-sm leading-tight font-medium text-foreground"
                        style={`--book-title-name: book-title-${book.hiveId}`}
                      >
                        {book.title}
                      </h3>
                      <p class="line-clamp-1 text-xs text-muted-foreground">{book.authors.split("\t").join(", ")}</p>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-2" onclick="event.stopPropagation()">
                  <StatusSelect book={book} redirectUrl={redirectUrl} />
                </td>
                <td class="px-4 py-2" onclick="event.stopPropagation()">
                  <RatingSelect book={book} redirectUrl={redirectUrl} />
                </td>
                <td class="px-4 py-2" onclick="event.stopPropagation()">
                  <div class="space-y-1">
                    <div class="flex items-center gap-1">
                      <svg class="h-3.5 w-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Started">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <DateInputForm book={book} field="startedAt" redirectUrl={redirectUrl} />
                    </div>
                    <div class="flex items-center gap-1">
                      <svg class="h-3.5 w-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Finished">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
                      </svg>
                      <DateInputForm book={book} field="finishedAt" redirectUrl={redirectUrl} />
                    </div>
                  </div>
                </td>
                <td class="px-4 py-2" onclick="event.stopPropagation()">
                  <form
                    action={`/books/${book.hiveId}${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`}
                    method="post"
                  >
                    <input type="hidden" name="_method" value="DELETE" />
                    <button
                      type="submit"
                      class="inline-flex items-center rounded-md p-2 text-red-600 hover:bg-red-50 hover:text-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                      title="Delete book from library"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1H8a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: card view */}
      <div class="space-y-4 md:hidden">
        {sortedBooks.map((book) => (
          <Card key={book.hiveId}>
            <CardBody class="flex gap-3">
              <BookCard
                variant="row"
                size="compact"
                class="flex-1 min-w-0"
                showStatus={true}
                book={normalizeBookData(book)}
              />
              <CardActions
                class="shrink-0 flex-col items-stretch"
                onclick="event.stopPropagation()"
              >
                <StatusSelect book={book} redirectUrl={redirectUrl} />
                <div class="mt-2 grid grid-cols-2 gap-2">
                  <div class="flex items-center gap-1">
                    <svg class="h-3.5 w-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Started">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <DateInputForm book={book} field="startedAt" redirectUrl={redirectUrl} />
                  </div>
                  <div class="flex items-center gap-1">
                    <svg class="h-3.5 w-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Finished">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <DateInputForm book={book} field="finishedAt" redirectUrl={redirectUrl} />
                  </div>
                </div>
                <form
                  action={`/books/${book.hiveId}${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`}
                  method="post"
                  class="mt-1 flex justify-end"
                >
                  <input type="hidden" name="_method" value="DELETE" />
                  <button
                    type="submit"
                    class="text-xs text-destructive hover:text-destructive/80 focus:outline-none"
                  >
                    Remove
                  </button>
                </form>
              </CardActions>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
};
