/** @jsx createElement */
import {
  type FC,
  // @ts-ignore
  createElement,
  Fragment,
} from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { formatDate, formatDistanceToNow } from "date-fns";
import type { BookResult } from "../scrapers";
import * as BookStatus from "../bsky/lexicon/types/buzz/bookhive/defs";
import { Script } from "./utils/script";

const BOOK_STATUS_MAP = {
  [BookStatus.ABANDONED]: "abandoned",
  [BookStatus.READING]: "currently reading",
  [BookStatus.WANTTOREAD]: "want to read",
  [BookStatus.OWNED]: "owned",
  [BookStatus.FINISHED]: "have read",
};

async function Recommendations({
  book,
  // did,
}: {
  book: BookResult;
  did: string | null;
}) {
  const c = useRequestContext();
  const relatedBooks = await c
    .get("ctx")
    .db.selectFrom("book")
    .selectAll()
    .where("book.hiveId", "==", book.id)
    // .where("authorDid", "!=", did)
    .limit(10)
    .execute();

  const didHandleMap = await c
    .get("ctx")
    .resolver.resolveDidsToHandles(relatedBooks.map((s) => s.authorDid));

  // const nonAuthorRelatedBooks = relatedBooks.filter(
  //   (related) => related.authorDid !== did,
  // );

  if (!relatedBooks.length) {
    return (
      <div class="rounded-xl bg-gray-900 px-2 py-5 text-center">
        Be the first to read this on bookhive!
      </div>
    );
  }

  // if (nonAuthorRelatedBooks.length === 0) {
  //   return (
  //     <div class="rounded-xl bg-gray-900 px-2 py-5 text-center">
  //       First to read this book on bookhive!
  //     </div>
  //   );
  // }

  return (
    <Fragment>
      <h3 class="my-5 px-2 text-xl leading-2">
        Who else is reading this book?
      </h3>
      <div class="flex flex-col gap-2">
        {relatedBooks.map((related) => {
          const handle = didHandleMap[related.authorDid] || related.authorDid;
          return (
            <a
              key={related.authorDid}
              href={`/profile/${handle}`}
              class="block cursor-pointer rounded-sm border border-slate-400 px-2 py-2 hover:bg-slate-700"
            >
              <span class="text-blue-600">@{handle}</span> - marked as{" "}
              {related.status && related.status in BOOK_STATUS_MAP
                ? BOOK_STATUS_MAP[
                    related.status as keyof typeof BOOK_STATUS_MAP
                  ]
                : related.status || BOOK_STATUS_MAP[BookStatus.READING]}{" "}
              {formatDistanceToNow(related.createdAt)} ago
            </a>
          );
        })}
      </div>
    </Fragment>
  );
}

const BookStatusButton: FC<{
  book: BookResult;
  did: string | null;
}> = async ({ did, book }) => {
  const c = useRequestContext();

  const usersBook = did
    ? await c
        .get("ctx")
        .db.selectFrom("book")
        .selectAll()
        .where("authorDid", "==", did)
        .where("book.hiveId", "==", book.id)
        .executeTakeFirst()
    : undefined;

  return (
    <form action="/books" method="post" class="mt-4">
      {usersBook && (
        <h3 class="leading-10">{`${usersBook.finishedAt ? "Finished" : usersBook.startedAt ? "Started" : "Added"}: ${formatDate(usersBook.finishedAt ?? usersBook.startedAt ?? usersBook.createdAt, `MMM d, yyyy`)}`}</h3>
      )}
      <div className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded="false"
          aria-labelledby="status-label"
          className="peer w-full cursor-pointer rounded-md bg-white px-3 py-2 text-left text-sm font-medium text-gray-900 ring-1 shadow-sm ring-gray-300 ring-inset hover:bg-gray-50 focus:ring-2 focus:ring-indigo-600 focus:outline-none dark:bg-slate-800 dark:text-white dark:hover:bg-slate-900"
          id="status-dropdown"
        >
          <span
            id="status-label"
            className="flex items-center justify-between capitalize"
          >
            <span>
              {(usersBook?.status &&
                (usersBook.status in BOOK_STATUS_MAP
                  ? BOOK_STATUS_MAP[
                      usersBook.status as keyof typeof BOOK_STATUS_MAP
                    ]
                  : usersBook.status)) ||
                "Add to shelf"}
            </span>
            <svg
              className="h-5 w-5 text-gray-400"
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
          aria-labelledby="status-label"
          className="ring-opacity-5 invisible absolute z-10 mt-1 w-full rounded-md bg-white opacity-0 ring-1 shadow-lg ring-black transition-all duration-100 ease-in-out peer-aria-expanded:visible peer-aria-expanded:opacity-100 dark:bg-slate-800"
          id="status-dropdown-menu"
        >
          <div className="p-1">
            {[
              {
                value: BookStatus.FINISHED,
                label: "Have Read",
              },
              {
                value: BookStatus.READING,
                label: "Currently Reading",
              },
              {
                value: BookStatus.WANTTOREAD,
                label: "Want to Read",
              },
              {
                value: BookStatus.ABANDONED,
                label: "Abandoned",
              },
            ].map((status) => (
              <button
                key={status.value}
                type="submit"
                role="option"
                aria-selected={usersBook?.status === status.value}
                name="status"
                value={status.value}
                className={`relative my-1 w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm ${
                  usersBook?.status === status.value
                    ? "bg-indigo-600 text-white"
                    : "text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-slate-700"
                }`}
              >
                <span className="block truncate">{status.label}</span>
                {usersBook?.status === status.value && (
                  <span
                    className="absolute inset-y-0 right-2 flex items-center"
                    aria-hidden="true"
                  >
                    <svg
                      className="h-4 w-4"
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
      </div>

      <Script
        script={(document) => {
          const dropdown = document.getElementById("status-dropdown")!;
          const dropdownMenu = document.getElementById("status-dropdown-menu")!;
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
              !dropdown.contains(e.target as any) &&
              !dropdownMenu.contains(e.target as any)
            ) {
              dropdown.setAttribute("aria-expanded", "false");
            }
          });
        }}
      />

      <input type="hidden" name="author" value={book.authors.join(", ")} />
      <input type="hidden" name="title" value={book.title} />
      {book.publishedDate && (
        <input
          type="hidden"
          name="year"
          value={new Date(book.publishedDate).getFullYear()}
        />
      )}
      <input type="hidden" name="hiveId" value={book.id} />
      <input type="hidden" name="coverImage" value={book.cover} />
    </form>
  );
};

export const BookInfo: FC<{
  book: BookResult;
}> = async ({ book }) => {
  const c = useRequestContext();
  const did =
    (await c.get("ctx").getSessionAgent(c.req.raw, c.res))?.did ?? null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Left Column - Book Info */}
        <div className="lg:w-3/4">
          <div className="mb-8 flex flex-col gap-8 rounded-xl bg-gray-900 p-6 shadow-md md:flex-row">
            <div className="w-full p-1 md:w-1/3 lg:w-1/4">
              <div className="relative m-0 grid cursor-default break-inside-avoid p-4">
                {/* From: https://codepen.io/mardisstudio/pen/ExBqRqE and converted to Tailwind */}
                <div className="relative">
                  {/* Book spine/inside effect */}
                  <div className="absolute top-[1%] left-4 h-[96%] w-[90%] rounded-r-md border border-gray-400 bg-white shadow-[10px_40px_40px_-10px_rgba(0,0,0,0.12),inset_-2px_0_0_gray,inset_-3px_0_0_#dbdbdb,inset_-4px_0_0_white,inset_-5px_0_0_#dbdbdb,inset_-6px_0_0_white,inset_-7px_0_0_#dbdbdb,inset_-8px_0_0_white,inset_-9px_0_0_#dbdbdb]" />

                  {/* Book cover with image */}
                  <div className="relative -translate-x-[10px] scale-x-[0.94] -rotate-y-[15deg] transform cursor-pointer rounded-r-md leading-none shadow-[6px_6px_18px_-2px_rgba(0,0,0,0.2),24px_28px_40px_-6px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out perspective-[2000px] hover:translate-x-0 hover:scale-x-100 hover:rotate-y-0 hover:shadow-[6px_6px_12px_-1px_rgba(0,0,0,0.1),20px_14px_16px_-6px_rgba(0,0,0,0.1)]">
                    <img
                      src={book.cover || book.thumbnail}
                      alt={`Cover of ${book.title}`}
                      className="col-span-1 row-span-full aspect-2/3 w-full rounded-r-md object-cover"
                    />

                    {/* Light effect overlay */}
                    <div className="absolute top-0 z-[5] ml-4 h-full w-5 border-l-2 border-black/5 bg-gradient-to-r from-white/20 to-transparent transition-all duration-500 group-hover:ml-[14px]" />

                    {/* Shine effect */}
                    <div className="absolute top-0 right-0 z-[4] h-full w-[90%] rounded bg-gradient-to-r from-transparent to-white/20 opacity-10 transition-all duration-500" />
                  </div>
                </div>
              </div>
              <BookStatusButton did={did} book={book} />
            </div>

            <div className="flex-1">
              <h1 className="mt-4 mb-1 text-3xl font-bold dark:text-gray-100">
                {book.title}
              </h1>
              <p className="mb-4 text-xl dark:text-gray-400">
                by {book.authors.join(", ")}
              </p>

              <div className="mb-8 flex items-center gap-1">
                <div className="-ml-2 flex -space-x-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                      class="relative inline-flex w-8"
                      viewBox="0 0 24 24"
                      key={star}
                    >
                      {/* Background star (gray) */}
                      <path
                        class="fill-current text-gray-300"
                        d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                      />
                      {/* Filled star (yellow) with clip */}
                      <path
                        style={{
                          clipPath: `inset(0 ${100 - Math.min(100, Math.max(0, ((book.rating || 0) - (star - 1)) * 100))}% 0 0)`,
                        }}
                        class="fill-current text-yellow-300"
                        d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                      />
                    </svg>
                  ))}
                </div>
                {book.rating && (
                  <span className="text-xl font-semibold">{book.rating}</span>
                )}
                {book.ratingsCount && (
                  <span className="text-sm text-gray-500 dark:text-gray-300">
                    ({book.ratingsCount.toLocaleString()} ratings)
                  </span>
                )}
              </div>

              <p className="mb-6 leading-relaxed text-gray-700 dark:text-gray-300">
                {book.description || "No description available"}
              </p>
              <div className="mt-4 flex items-center">
                <a
                  href={book.url}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-600 p-2 hover:bg-slate-800"
                >
                  Goodreads
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
                    <path d="m21 3-9 9" />
                    <path d="M15 3h6v6" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Recommendations */}
        <aside className="lg:w-1/4">
          <Recommendations book={book} did={did} />
        </aside>
      </div>
    </div>
  );
};
