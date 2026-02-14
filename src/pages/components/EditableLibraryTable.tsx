import { type FC } from "hono/jsx";
import { formatDistanceToNow } from "date-fns";
import type { Book } from "../../types";
import { BOOK_STATUS, BOOK_STATUS_MAP } from "../../constants";

const UpdateBookForm: FC<{
  book: Book;
  children: any;
}> = ({ book, children }) => {
  return (
    <form action="/books" method="post">
      <input type="hidden" name="authors" value={book.authors} />
      <input type="hidden" name="title" value={book.title} />
      <input type="hidden" name="hiveId" value={book.hiveId} />
      {book.cover && (
        <input type="hidden" name="coverImage" value={book.cover} />
      )}
      {book.startedAt && (
        <input type="hidden" name="startedAt" value={book.startedAt} />
      )}
      {book.finishedAt && (
        <input type="hidden" name="finishedAt" value={book.finishedAt} />
      )}
      {book.stars && (
        <input type="hidden" name="stars" value={String(book.stars)} />
      )}
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
          class="peer w-full cursor-pointer rounded-md bg-white px-3 py-2 text-left text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-300 ring-inset hover:bg-zinc-50 focus:ring-2 focus:ring-yellow-600 focus:outline-none dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-900"
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
                "Add to shelf"}
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
          class="ring-opacity-5 invisible absolute z-10 mt-1 w-full rounded-md bg-yellow-50 opacity-0 shadow-lg ring-1 ring-black transition-all duration-100 ease-in-out peer-aria-expanded:visible peer-aria-expanded:opacity-100 dark:bg-zinc-800"
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
                    ? "bg-yellow-900 text-white"
                    : "text-gray-900 hover:bg-zinc-50 dark:text-white dark:hover:bg-zinc-700"
                }`}
              >
                <span class="block truncate">{status.label}</span>
                {book.status === status.value && (
                  <span
                    class="absolute inset-y-0 right-2 flex items-center"
                    aria-hidden="true"
                  >
                    <svg
                      class="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
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
      <div class="rounded-xl border border-gray-200 bg-yellow-50 px-6 py-8 text-center dark:border-gray-700 dark:bg-zinc-900">
        <p class="text-lg text-gray-600 dark:text-gray-300">
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
      return (
        new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()
      );
    }

    // If only one is finished, prioritize based on general creation date
    // This keeps the overall list in a sensible order
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-zinc-800">
      <table class="w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="sticky top-0 z-10 bg-yellow-50 dark:bg-zinc-900">
          <tr>
            <th
              class="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white"
              style="width: 35%"
            >
              Book
            </th>
            <th
              class="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white"
              style="width: 20%"
            >
              Authors
            </th>
            <th
              class="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white"
              style="width: 15%"
            >
              Status
            </th>
            <th
              class="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white"
              style="width: 12%"
            >
              Rating
            </th>
            <th class="px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-gray-900 dark:text-white">
              Started
            </th>
            <th class="px-4 py-2 text-left text-sm font-semibold whitespace-nowrap text-gray-900 dark:text-white">
              Finished
            </th>
            <th
              class="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white"
              style="width: 8%"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-zinc-800">
          {sortedBooks.map((book, index) => (
            <tr
              key={book.hiveId}
              class="cursor-pointer transition-colors duration-150 hover:bg-yellow-50/50 dark:hover:bg-zinc-700/50"
              onclick={`window.location.href='/books/${book.hiveId}'`}
            >
              <td class="px-4 py-2">
                <div class="flex items-center space-x-3">
                  <div class="h-12 w-8 flex-shrink-0 overflow-hidden rounded-md">
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
                    <div class="hidden h-full w-full items-center justify-center bg-gradient-to-br from-yellow-100 to-yellow-200 dark:from-zinc-600 dark:to-zinc-700">
                      <svg
                        class="h-6 w-6 text-yellow-600 dark:text-yellow-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div class="min-w-0 flex-1">
                    <h3
                      class="book-title line-clamp-3 text-sm leading-tight font-medium text-gray-900 dark:text-white"
                      style={`--book-title-name: book-title-${book.hiveId}`}
                    >
                      {book.title}
                    </h3>
                  </div>
                </div>
              </td>
              <td class="px-4 py-2">
                <p class="text-sm text-gray-900 dark:text-white">
                  {book.authors.split("\t").join(", ")}
                </p>
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
                        class="fill-current text-gray-300 dark:text-gray-600"
                        d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z"
                      />
                      {/* Filled star (yellow) with clip */}
                      <path
                        style={{
                          clipPath: `inset(0 ${100 - Math.min(100, Math.max(0, ((book.stars || 0) / 2 - (star - 1)) * 100))}% 0 0)`,
                        }}
                        class="fill-current text-yellow-400"
                        d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z"
                      />
                    </svg>
                  ))}
                </div>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {book.startedAt
                    ? formatDistanceToNow(new Date(book.startedAt), {
                        addSuffix: true,
                      })
                    : "-"}
                </p>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <p class="text-sm text-gray-500 dark:text-gray-400">
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
  );
};
