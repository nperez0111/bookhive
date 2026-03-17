import { type FC } from "hono/jsx";
import { formatDistanceToNow } from "date-fns";
import type { Book } from "../../types";
import { BOOK_STATUS, BOOK_STATUS_MAP } from "../../constants";
import { Card, CardBody, BookBlock, CardActions } from "./cards";

const UpdateBookForm: FC<{
  book: Book;
  children: any;
}> = ({ book, children }) => {
  return (
    <form action="/books" method="post">
      <input type="hidden" name="authors" value={book.authors} />
      <input type="hidden" name="title" value={book.title} />
      <input type="hidden" name="hiveId" value={book.hiveId} />
      {book.cover && <input type="hidden" name="coverImage" value={book.cover} />}
      {book.startedAt && <input type="hidden" name="startedAt" value={book.startedAt} />}
      {book.finishedAt && <input type="hidden" name="finishedAt" value={book.finishedAt} />}
      {book.stars && <input type="hidden" name="stars" value={String(book.stars)} />}
      {book.review && <input type="hidden" name="review" value={book.review} />}
      {children}
    </form>
  );
};

const StatusDropdown: FC<{
  book: Book;
  bookIndex: number;
}> = ({ book, bookIndex }) => {
  const dropdownId = `status-dropdown-${bookIndex}`;
  const dropdownMenuId = `status-dropdown-menu-${bookIndex}`;

  return (
    <div class="relative">
      <UpdateBookForm book={book}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded="false"
          aria-labelledby={`status-label-${bookIndex}`}
          class="peer w-full cursor-pointer rounded-md bg-card px-3 py-2 text-left text-sm font-medium text-foreground shadow-sm ring-1 ring-border ring-inset hover:bg-muted focus:ring-2 focus:ring-primary focus:outline-none"
          id={dropdownId}
        >
          <span
            id={`status-label-${bookIndex}`}
            class="flex items-center justify-between capitalize"
          >
            <span>
              {(book.status &&
                (book.status in BOOK_STATUS_MAP
                  ? BOOK_STATUS_MAP[book.status as keyof typeof BOOK_STATUS_MAP]
                  : book.status)) ||
                "Reading status"}
            </span>
            <svg
              class="h-5 w-5 text-gray-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </button>

        <div
          role="listbox"
          aria-labelledby={`status-label-${bookIndex}`}
          class="ring-opacity-5 invisible absolute z-10 mt-1 w-full rounded-md bg-card opacity-0 shadow-lg ring-1 ring-border transition-all duration-100 ease-in-out peer-aria-expanded:visible peer-aria-expanded:opacity-100"
          id={dropdownMenuId}
        >
          <div class="p-1">
            {[
              {
                value: BOOK_STATUS.FINISHED,
                label: "Read",
              },
              {
                value: BOOK_STATUS.READING,
                label: "Reading",
              },
              {
                value: BOOK_STATUS.WANTTOREAD,
                label: "Want to Read",
              },
              {
                value: BOOK_STATUS.ABANDONED,
                label: "Abandoned",
              },
            ].map((status) => (
              <button
                key={status.value}
                type="submit"
                role="option"
                aria-selected={book.status === status.value}
                name="status"
                value={status.value}
                class={`relative my-1 w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm ${
                  book.status === status.value
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span class="block truncate">{status.label}</span>
                {book.status === status.value && (
                  <span class="absolute inset-y-0 right-2 flex items-center" aria-hidden="true">
                    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </UpdateBookForm>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              const dropdown = document.getElementById("${dropdownId}");
              const dropdownMenu = document.getElementById("${dropdownMenuId}");
              
              if (!dropdown || !dropdownMenu) return;
              
              dropdown.addEventListener("click", () => {
                dropdown.setAttribute(
                  "aria-expanded",
                  dropdown.getAttribute("aria-expanded") === "true"
                    ? "false"
                    : "true",
                );
              });
              
              document.addEventListener("click", (e) => {
                if (
                  dropdown.getAttribute("aria-expanded") === "true" &&
                  !dropdown.contains(e.target) &&
                  !dropdownMenu.contains(e.target)
                ) {
                  dropdown.setAttribute("aria-expanded", "false");
                }
              });
            })();
          `,
        }}
      />
    </div>
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
        <table class="table w-full">
          <thead class="sticky top-0 z-10 bg-muted">
            <tr>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 35%"
              >
                Book
              </th>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 20%"
              >
                Authors
              </th>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 15%"
              >
                Status
              </th>
              <th
                class="px-4 py-2 text-left text-sm font-semibold text-foreground"
                style="width: 12%"
              >
                Rating
              </th>
              <th class="px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-foreground">
                Started
              </th>
              <th class="px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-foreground">
                Finished
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
            {sortedBooks.map((book, index) => (
              <tr
                key={book.hiveId}
                class="cursor-pointer transition-colors duration-150 hover:bg-muted/60"
                onclick={`window.location.href='/books/${book.hiveId}'`}
              >
                <td class="px-4 py-2">
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
                        class="book-title line-clamp-3 text-sm leading-tight font-medium text-foreground"
                        style={`--book-title-name: book-title-${book.hiveId}`}
                      >
                        {book.title}
                      </h3>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-2">
                  <p class="text-sm text-foreground">{book.authors.split("\t").join(", ")}</p>
                </td>
                <td class="px-4 py-2" onclick="event.stopPropagation()">
                  <StatusDropdown book={book} bookIndex={index} />
                </td>
                <td class="px-4 py-2">
                  <div class="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg key={star} class="h-4 w-4" viewBox="0 0 24 24">
                        {/* Background star (gray) */}
                        <path
                          class="fill-current text-muted-foreground/40"
                          d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z"
                        />
                        {/* Filled star (yellow) with clip */}
                        <path
                          style={{
                            clipPath: `inset(0 ${100 - Math.min(100, Math.max(0, ((book.stars || 0) / 2 - (star - 1)) * 100))}% 0 0)`,
                          }}
                          class="fill-current text-accent"
                          d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z"
                        />
                      </svg>
                    ))}
                  </div>
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <p class="text-sm text-muted-foreground">
                    {book.startedAt
                      ? formatDistanceToNow(new Date(book.startedAt), {
                          addSuffix: true,
                        })
                      : "-"}
                  </p>
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <p class="text-sm text-muted-foreground">
                    {book.finishedAt
                      ? formatDistanceToNow(new Date(book.finishedAt), {
                          addSuffix: true,
                        })
                      : "-"}
                  </p>
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
        {sortedBooks.map((book, index) => (
          <Card key={book.hiveId}>
            <CardBody class="flex gap-3">
              <BookBlock
                hiveId={book.hiveId}
                title={book.title}
                authors={book.authors}
                cover={book.cover}
                thumbnail={book.thumbnail}
                size="compact"
                stars={book.stars}
                status={book.status}
                showStatus={true}
                class="flex-1 min-w-0"
              />
              <CardActions
                class="shrink-0 flex-col items-stretch"
                onclick="event.stopPropagation()"
              >
                <StatusDropdown book={book} bookIndex={index} />
                <form
                  action={`/books/${book.hiveId}${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`}
                  method="post"
                  class="mt-1"
                >
                  <input type="hidden" name="_method" value="DELETE" />
                  <button type="submit" class="btn btn-ghost text-destructive text-xs">
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
