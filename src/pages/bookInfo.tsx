import { formatDistanceToNow } from "date-fns";
import { type FC, type PropsWithChildren, Fragment } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { sql } from "kysely";
import { BOOK_STATUS, BOOK_STATUS_MAP } from "../constants";
import type { HiveBook, UserBook } from "../types";
import { hydrateUserBook } from "../utils/bookProgress";
import { CommentsSection } from "./comments";
import { Script } from "./utils/script";

async function Recommendations({
  book,
  did,
}: {
  book: HiveBook;
  did: string | null;
}) {
  const c = useRequestContext();
  const peerBooks = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .selectAll()
    .where("hiveId", "==", book.id)
    .orderBy("indexedAt", "desc")
    .limit(100)
    .execute();

  const didHandleMap = await c
    .get("ctx")
    .resolver.resolveDidsToHandles(peerBooks.map((s) => s.userDid));

  if (!peerBooks.length) {
    return (
      <div class="rounded-xl border border-gray-200 bg-yellow-50 px-2 py-5 text-center dark:border-gray-700 dark:bg-zinc-900">
        Be the first to read this on bookhive!
      </div>
    );
  }

  if (peerBooks.every((related) => related.userDid === did)) {
    return (
      <div class="rounded-xl border border-gray-200 bg-yellow-50 px-2 py-5 text-center dark:border-gray-700 dark:bg-zinc-900">
        You are the only one to have added this on bookhive, so far!
      </div>
    );
  }

  return (
    <Fragment>
      <h3 class="my-5 px-2 text-xl leading-6">
        Who else is reading this book?
      </h3>
      <div class="flex flex-col gap-2">
        {peerBooks.map((related) => {
          const handle = didHandleMap[related.userDid] || related.userDid;
          return (
            <a
              key={related.userDid}
              href={`/profile/${handle}`}
              class="block cursor-pointer rounded-xl border border-zinc-400 bg-yellow-50 px-2 py-2 hover:bg-zinc-100 dark:border-gray-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <span class="text-blue-600">@{handle}</span> - marked as{" "}
              {related.status && related.status in BOOK_STATUS_MAP
                ? BOOK_STATUS_MAP[
                    related.status as keyof typeof BOOK_STATUS_MAP
                  ]
                : related.status || BOOK_STATUS_MAP[BOOK_STATUS.READING]}{" "}
              {formatDistanceToNow(related.indexedAt, { addSuffix: true })}
              {related.stars && <span> - rated {related.stars / 2}</span>}
              {related.review && <span> - reviewed</span>}
            </a>
          );
        })}
      </div>
    </Fragment>
  );
}

const UpdateBookForm: FC<
  PropsWithChildren<{
    book: HiveBook;
    userBook: UserBook | undefined;
    editing?: "stars" | "review" | "status" | "startedAt" | "finishedAt";
    formId?: string;
  }>
> = ({ book, userBook, editing, formId, children }) => {
  return (
    <form action="/books" method="post" id={formId}>
      <input type="hidden" name="authors" value={book.authors} />
      <input type="hidden" name="title" value={book.title} />
      <input type="hidden" name="hiveId" value={book.id} />
      {book.cover && (
        <input type="hidden" name="coverImage" value={book.cover} />
      )}
      {userBook?.startedAt &&
        editing !== "startedAt" &&
        editing !== "status" && (
          <input type="hidden" name="startedAt" value={userBook.startedAt} />
        )}
      {userBook?.finishedAt &&
        editing !== "finishedAt" &&
        editing !== "status" && (
          <input type="hidden" name="finishedAt" value={userBook.finishedAt} />
        )}
      {userBook?.stars && editing !== "stars" && (
        <input type="hidden" name="stars" value={String(userBook.stars)} />
      )}
      {userBook?.review && editing !== "review" && (
        <input type="hidden" name="review" value={userBook.review} />
      )}
      {userBook?.status && editing !== "status" && (
        <input type="hidden" name="status" value={userBook.status} />
      )}
      {editing === "status" && (
        <>
          <input type="hidden" name="startedAt" id="auto-started-at" value="" />
          <input
            type="hidden"
            name="finishedAt"
            id="auto-finished-at"
            value=""
          />
        </>
      )}
      {children}
    </form>
  );
};

const BookStatusButton: FC<{
  book: HiveBook;
  usersBook: UserBook | undefined;
}> = async ({ usersBook, book }) => {
  return (
    <div class="mt-4">
      <UpdateBookForm book={book} userBook={usersBook} editing="status">
        {usersBook && (
          <h3 class="my-3 leading-6">{`${usersBook.finishedAt ? "Finished" : usersBook.startedAt ? "Started" : "Added"}: ${formatDistanceToNow(
            usersBook.finishedAt ?? usersBook.startedAt ?? usersBook.createdAt,
            {
              addSuffix: true,
            },
          )}`}</h3>
        )}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded="false"
            aria-labelledby="status-label"
            className="peer w-full cursor-pointer rounded-md bg-white px-3 py-2 text-left text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-300 ring-inset hover:bg-zinc-50 focus:ring-2 focus:ring-yellow-600 focus:outline-none dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-900"
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
            className="ring-opacity-5 invisible absolute z-10 mt-1 w-full rounded-md bg-yellow-50 opacity-0 shadow-lg ring-1 ring-black transition-all duration-100 ease-in-out peer-aria-expanded:visible peer-aria-expanded:opacity-100 dark:bg-zinc-800"
            id="status-dropdown-menu"
          >
            <div className="p-1">
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
                  aria-selected={usersBook?.status === status.value}
                  name="status"
                  value={status.value}
                  className={`relative my-1 w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm ${
                    usersBook?.status === status.value
                      ? "bg-yellow-900 text-white"
                      : "text-gray-900 hover:bg-zinc-50 dark:text-white dark:hover:bg-zinc-700"
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
            const dropdownMenu = document.getElementById(
              "status-dropdown-menu",
            )!;
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
      </UpdateBookForm>
      {usersBook && (
        <form action={`/books/${book.id}`} method="post">
          <button
            type="submit"
            class="mt-2 cursor-pointer rounded-md border border-red-500 px-3 py-1 text-xs text-red-500 hover:bg-red-500 hover:text-white dark:border-red-400 dark:hover:bg-red-400 dark:hover:text-white"
          >
            Delete
          </button>
          <input type="hidden" name="_method" value="DELETE" />
        </form>
      )}
    </div>
  );
};

export const BookInfo: FC<{
  book: HiveBook;
}> = async ({ book }) => {
  const c = useRequestContext();
  const did = (await c.get("ctx").getSessionAgent())?.did ?? null;

  const rawUserBook = did
    ? await c
        .get("ctx")
        .db.selectFrom("user_book")
        .selectAll()
        .where("userDid", "==", did)
        .where("hiveId", "==", book.id)
        .executeTakeFirst()
    : undefined;
  const usersBook = rawUserBook ? hydrateUserBook(rawUserBook) : undefined;

  const reviewsOfThisBook = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .select([
      "user_book.hiveId",
      "user_book.createdAt",
      "user_book.uri",
      "user_book.cid",
      "user_book.userDid",
      "user_book.review",
      "user_book.stars",
      (eb) =>
        eb
          .selectFrom("buzz")
          .select(sql<number>`count(*)`.as("commentCount"))
          .where("buzz.parentUri", "=", eb.ref("user_book.uri"))
          .as("commentCount"),
    ])
    .where("user_book.hiveId", "=", book.id)
    .where("user_book.review", "!=", "")
    .orderBy("user_book.createdAt", "desc")
    .limit(10_000)
    .execute();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Left Column - Book Info */}
        <div className="lg:w-3/4">
          <div className="mb-8 flex flex-col gap-8 rounded-xl border border-gray-200 bg-yellow-50 p-6 shadow-md md:flex-row dark:border-gray-700 dark:bg-zinc-900">
            <div className="w-2/3 p-1 sm:w-1/2 md:w-1/3 lg:w-1/4">
              <div className="relative m-0 grid cursor-default break-inside-avoid p-4">
                {/* From: https://codepen.io/mardisstudio/pen/ExBqRqE and converted to Tailwind */}
                <div className="relative">
                  {/* Book spine/inside effect */}
                  <div className="absolute top-[1%] left-4 h-[96%] w-[90%] rounded-r-md border border-gray-400 bg-white shadow-[10px_40px_40px_-10px_rgba(0,0,0,0.12),inset_-2px_0_0_gray,inset_-3px_0_0_#dbdbdb,inset_-4px_0_0_white,inset_-5px_0_0_#dbdbdb,inset_-6px_0_0_white,inset_-7px_0_0_#dbdbdb,inset_-8px_0_0_white,inset_-9px_0_0_#dbdbdb]" />

                  {/* Book cover with image */}
                  <div className="relative -translate-x-[10px] scale-x-[0.94] -rotate-y-[15deg] transform cursor-pointer rounded-r-md leading-none shadow-[6px_6px_18px_-2px_rgba(0,0,0,0.2),24px_28px_40px_-6px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out perspective-[2000px] hover:translate-x-0 hover:scale-x-100 hover:rotate-y-0 hover:shadow-[6px_6px_12px_-1px_rgba(0,0,0,0.1),20px_14px_16px_-6px_rgba(0,0,0,0.1)]">
                    <img
                      src={`${book.cover || book.thumbnail}`}
                      // src={`/images/w_300/${book.cover || book.thumbnail}`}
                      alt={`Cover of ${book.title}`}
                      className="book-cover col-span-1 row-span-full aspect-2/3 w-full rounded-r-md object-cover"
                      style={`--book-cover-name: book-cover-${book.id}`}
                    />

                    {/* Light effect overlay */}
                    <div className="absolute top-0 z-[5] ml-4 h-full w-5 border-l-2 border-black/5 bg-gradient-to-r from-white/20 to-transparent transition-all duration-500 group-hover:ml-[14px]" />

                    {/* Shine effect */}
                    <div className="absolute top-0 right-0 z-[4] h-full w-[90%] rounded bg-gradient-to-r from-transparent to-white/20 opacity-10 transition-all duration-500" />
                  </div>
                </div>
              </div>
              {did && <BookStatusButton usersBook={usersBook} book={book} />}
            </div>

            <div className="flex-1">
              <h1
                className="book-title mt-4 mb-1 text-3xl font-bold dark:text-gray-100"
                style={`--book-title-name: book-title-${book.id}`}
              >
                {book.title}
              </h1>
              <p className="mb-4 text-xl dark:text-gray-400">
                by{" "}
                {book.authors.split("\t").map((author, index, array) => (
                  <Fragment key={author}>
                    <a
                      href={`/authors/${encodeURIComponent(author)}`}
                      className="text-yellow-600 hover:text-yellow-700 hover:underline dark:text-yellow-400 dark:hover:text-yellow-300"
                    >
                      {author}
                    </a>
                    {index < array.length - 1 && ", "}
                  </Fragment>
                ))}
              </p>

              <div className="mb-8 flex items-center gap-1">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                      class="relative inline-flex h-6 w-6 space-x-1"
                      viewBox="0 0 24 24"
                      key={star}
                    >
                      {/* Background star (gray) */}
                      <path
                        class="fill-current text-gray-300"
                        d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z"
                      />
                      {/* Filled star (yellow) with clip */}
                      <path
                        style={{
                          clipPath: `inset(0 ${100 - Math.min(100, Math.max(0, ((book.rating || 0) / 1000 - (star - 1)) * 100))}% 0 0)`,
                        }}
                        class="fill-current text-yellow-400"
                        d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z"
                      />
                    </svg>
                  ))}
                </div>
                {book.rating && (
                  <span className="text-xl font-semibold">
                    {book.rating / 1000}
                  </span>
                )}
                {book.ratingsCount && (
                  <span className="text-sm text-gray-500 dark:text-gray-300">
                    ({book.ratingsCount.toLocaleString()} ratings)
                  </span>
                )}
              </div>

              <div
                className="prose prose-sm dark:prose-invert mb-6 max-w-none leading-relaxed text-gray-700 dark:text-gray-300"
                dangerouslySetInnerHTML={{
                  __html: book.description || "No description available",
                }}
              />

              {book.genres && (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-400">
                    Genres
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {JSON.parse(book.genres).map(
                      (genre: string, index: number) => (
                        <a
                          key={index}
                          href={`/genres/${encodeURIComponent(genre)}`}
                          className="genre-name rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800 transition-colors hover:bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:hover:bg-yellow-800"
                          style={`--genre-name: genre-${genre}`}
                        >
                          {genre}
                        </a>
                      ),
                    )}
                  </div>
                </div>
              )}

              {book.series && (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-400">
                    Series
                  </h3>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {(() => {
                      const seriesData = JSON.parse(book.series);
                      return (
                        <span>
                          {seriesData.title}
                          {seriesData.position &&
                            ` (Book ${seriesData.position})`}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {book.meta && (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-400">
                    Publication Details
                  </h3>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {(() => {
                      const meta = JSON.parse(book.meta);
                      const details = [];
                      if (meta.publicationYear && meta.publicationYear > 0) {
                        details.push(meta.publicationYear);
                      }
                      if (meta.publisher) {
                        details.push(meta.publisher);
                      }
                      if (meta.language) {
                        details.push(meta.language);
                      }
                      return details.length > 0
                        ? details.join(" • ")
                        : "No publication details available";
                    })()}
                  </div>
                </div>
              )}

              {book.meta &&
                (() => {
                  const meta = JSON.parse(book.meta);
                  return (
                    meta.authorBio && (
                      <div className="mb-4">
                        <h3 className="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-400">
                          About the Author
                        </h3>
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-gray-700 dark:text-gray-300"
                          dangerouslySetInnerHTML={{
                            __html: meta.authorBio,
                          }}
                        />
                      </div>
                    )
                  );
                })()}

              {book.meta &&
                (() => {
                  const meta = JSON.parse(book.meta);
                  return (
                    meta.secondaryAuthors &&
                    meta.secondaryAuthors.length > 0 && (
                      <div className="mb-4">
                        <h3 className="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-400">
                          Additional Authors
                        </h3>
                        <div className="text-sm text-gray-700 dark:text-gray-300">
                          {meta.secondaryAuthors.map(
                            (author: any, index: number) => (
                              <span key={index}>
                                {author.name}
                                {index < meta.secondaryAuthors.length - 1 &&
                                  ", "}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    )
                  );
                })()}

              {book.sourceUrl && (
                <div className="mt-4 flex items-center">
                  <a
                    href={book.sourceUrl}
                    className="flex items-center justify-between gap-3 rounded-md border border-zinc-600 p-2 hover:bg-yellow-800 hover:text-white dark:hover:bg-zinc-800"
                  >
                    {book.source}
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
              )}
            </div>
          </div>
          {did && (
            <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-yellow-50 p-6 shadow-md md:flex-row dark:border-gray-700 dark:bg-zinc-900">
              <div class="md:w-1/3 lg:w-1/4">
                <h2 className="text-xl leading-2 font-bold">
                  {usersBook?.stars
                    ? `You Rated: ${usersBook?.stars / 2}`
                    : "Rating"}
                </h2>
                <div className="mt-2.5 text-sm text-gray-500 dark:text-gray-400">
                  Click to rate this book
                </div>
                <div className="my-8 mb-2">
                  <UpdateBookForm
                    book={book}
                    userBook={usersBook}
                    editing="stars"
                    formId="rating-form"
                  >
                    <input
                      type="hidden"
                      name="stars"
                      value={usersBook?.stars || 0}
                      id="rating-value"
                    />

                    <div id="star-rating" data-rating={usersBook?.stars}></div>
                  </UpdateBookForm>
                </div>
              </div>
              <div class="md:flex-1">
                <h2 className="text-xl leading-2 font-bold">
                  {usersBook?.review ? "Your Review" : "Review"}
                </h2>
                <div className="mt-2.5 text-sm text-gray-500 dark:text-gray-400">
                  Leave your review of this book
                </div>
                <div className="my-8 mb-2">
                  <UpdateBookForm
                    book={book}
                    userBook={usersBook}
                    editing="review"
                    formId="rating-form"
                  >
                    <div className="grid">
                      <textarea
                        className="col-start-1 row-start-1 min-h-[100px] w-full overflow-hidden rounded-md border-0 py-2 text-gray-900 shadow-xs ring-1 ring-gray-300 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-yellow-600 focus:ring-inset sm:text-sm dark:bg-zinc-800 dark:text-gray-50 dark:ring-gray-700"
                        style={{ resize: "none", gridArea: "1 / 1 / 2 / 2" }}
                        placeholder="Write your review here..."
                        name="review"
                      >
                        {usersBook?.review || ""}
                      </textarea>
                      <div
                        className="invisible col-start-1 row-start-1 overflow-hidden px-3 py-2 break-words whitespace-pre-wrap"
                        aria-hidden="true"
                      >
                        {usersBook?.review || " "}
                      </div>
                    </div>
                    <button
                      type="submit"
                      class="mt-2 cursor-pointer rounded-md bg-yellow-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-yellow-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
                    >
                      Save
                    </button>
                  </UpdateBookForm>
                </div>
              </div>
            </div>
          )}

          {did && usersBook?.status !== BOOK_STATUS.FINISHED && (
            <div className="mt-8 rounded-xl border border-gray-200 bg-yellow-50 p-6 shadow-md dark:border-gray-700 dark:bg-zinc-900">
              <h2 className="mb-2 text-xl font-bold">Reading Progress</h2>
              {usersBook?.bookProgress && (
                <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                  {[
                    usersBook.bookProgress.percent !== undefined
                      ? `${usersBook.bookProgress.percent}% complete`
                      : null,
                    usersBook.bookProgress.currentPage &&
                    usersBook.bookProgress.totalPages
                      ? `${usersBook.bookProgress.currentPage}/${usersBook.bookProgress.totalPages} pages`
                      : usersBook.bookProgress.currentPage
                        ? `${usersBook.bookProgress.currentPage} pages`
                        : null,
                    usersBook.bookProgress.updatedAt
                      ? `Updated ${formatDistanceToNow(
                          usersBook.bookProgress.updatedAt,
                          { addSuffix: true },
                        )}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <UpdateBookForm book={book} userBook={usersBook}>
                <div className="flex flex-col gap-4">
                  {/* Pages */}
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Pages read <span className="font-normal">/</span> Total
                      pages
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        id="progress-pages-current"
                        name="currentPage"
                        value={usersBook?.bookProgress?.currentPage ?? ""}
                        min={0}
                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 focus:outline-none dark:border-gray-600 dark:bg-zinc-800 dark:text-white"
                        placeholder="Current"
                      />
                      <span className="text-lg font-semibold text-gray-500 dark:text-gray-400">
                        /
                      </span>
                      <input
                        type="number"
                        id="progress-pages-total"
                        name="totalPages"
                        value={
                          usersBook?.bookProgress?.totalPages ??
                          (() => {
                            if (!book.meta) return "";
                            try {
                              const meta = JSON.parse(book.meta);
                              return meta?.numPages ? meta.numPages : "";
                            } catch {
                              return "";
                            }
                          })()
                        }
                        min={1}
                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 focus:outline-none dark:border-gray-600 dark:bg-zinc-800 dark:text-white"
                        placeholder="Total"
                      />
                    </div>
                  </div>
                  {/* Chapters */}
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Chapters read <span className="font-normal">/</span> Total
                      chapters
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        id="progress-chapters-current"
                        name="currentChapter"
                        value={usersBook?.bookProgress?.currentChapter ?? ""}
                        min={1}
                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 focus:outline-none dark:border-gray-600 dark:bg-zinc-800 dark:text-white"
                        placeholder="Current"
                      />
                      <span className="text-lg font-semibold text-gray-500 dark:text-gray-400">
                        /
                      </span>
                      <input
                        type="number"
                        id="progress-chapters-total"
                        name="totalChapters"
                        value={usersBook?.bookProgress?.totalChapters ?? ""}
                        min={1}
                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 focus:outline-none dark:border-gray-600 dark:bg-zinc-800 dark:text-white"
                        placeholder="Total"
                      />
                    </div>
                  </div>
                  {/* Percent */}
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Percent
                      </label>
                      <input
                        type="number"
                        id="progress-percent"
                        name="percent"
                        value={usersBook?.bookProgress?.percent ?? ""}
                        min={0}
                        max={100}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 focus:outline-none dark:border-gray-600 dark:bg-zinc-800 dark:text-white"
                        placeholder="Auto-calculated"
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Percent auto-fills from pages or chapters but can be
                      overridden.
                    </p>
                  </div>
                </div>
                <button
                  type="submit"
                  className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-yellow-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-yellow-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
                >
                  Save progress
                </button>
              </UpdateBookForm>
              <Script
                script={(document) => {
                  const pageCurrent = document.getElementById(
                    "progress-pages-current",
                  ) as HTMLInputElement;
                  const pageTotal = document.getElementById(
                    "progress-pages-total",
                  ) as HTMLInputElement;
                  const chapterCurrent = document.getElementById(
                    "progress-chapters-current",
                  ) as HTMLInputElement;
                  const chapterTotal = document.getElementById(
                    "progress-chapters-total",
                  ) as HTMLInputElement;
                  const percentInput = document.getElementById(
                    "progress-percent",
                  ) as HTMLInputElement;
                  function parseNumber(value: string | null) {
                    const parsed = Number(value);
                    return Number.isFinite(parsed) ? parsed : null;
                  }
                  function updatePercent() {
                    if (!percentInput) return;
                    const currentPage = parseNumber(pageCurrent?.value);
                    const totalPages = parseNumber(pageTotal?.value);
                    const currentChapter = parseNumber(chapterCurrent?.value);
                    const totalChapters = parseNumber(chapterTotal?.value);
                    let percent = null;
                    if (currentPage !== null && totalPages && totalPages > 0) {
                      percent = Math.min(
                        100,
                        Math.max(
                          0,
                          Math.round((currentPage / totalPages) * 100),
                        ),
                      );
                    } else if (
                      currentChapter !== null &&
                      totalChapters &&
                      totalChapters > 0
                    ) {
                      percent = Math.min(
                        100,
                        Math.max(
                          0,
                          Math.round((currentChapter / totalChapters) * 100),
                        ),
                      );
                    }
                    if (percent !== null) {
                      percentInput.value = percent.toString();
                    }
                  }
                  [
                    pageCurrent,
                    pageTotal,
                    chapterCurrent,
                    chapterTotal,
                  ].forEach((input) => {
                    input?.addEventListener("input", updatePercent);
                  });
                }}
              />
            </div>
          )}

          {/* Reading Dates Section */}
          {did && usersBook && (
            <div className="mt-8 rounded-xl border border-gray-200 bg-yellow-50 p-6 shadow-md dark:border-gray-700 dark:bg-zinc-900">
              <h2 className="mb-4 text-xl font-bold">Reading Dates</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Started Date */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Started Reading
                  </label>
                  <UpdateBookForm
                    book={book}
                    userBook={usersBook}
                    editing="startedAt"
                    formId="started-date-form"
                  >
                    <input
                      type="date"
                      name="startedAt"
                      value={
                        usersBook.startedAt
                          ? new Date(usersBook.startedAt)
                              .toISOString()
                              .slice(0, 10)
                          : ""
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 focus:outline-none dark:border-gray-600 dark:bg-zinc-800 dark:text-white"
                    />
                    <button
                      type="submit"
                      className="mt-2 cursor-pointer rounded-md bg-yellow-600 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-yellow-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
                    >
                      Save
                    </button>
                  </UpdateBookForm>
                </div>

                {/* Finished Date */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Finished Reading
                  </label>
                  <UpdateBookForm
                    book={book}
                    userBook={usersBook}
                    editing="finishedAt"
                    formId="finished-date-form"
                  >
                    <input
                      type="date"
                      name="finishedAt"
                      value={
                        usersBook.finishedAt
                          ? new Date(usersBook.finishedAt)
                              .toISOString()
                              .slice(0, 10)
                          : ""
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 focus:outline-none dark:border-gray-600 dark:bg-zinc-800 dark:text-white"
                    />
                    <button
                      type="submit"
                      className="mt-2 cursor-pointer rounded-md bg-yellow-600 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-yellow-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
                    >
                      Save
                    </button>
                  </UpdateBookForm>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Recommendations */}
        <aside className="lg:w-1/4">
          <Recommendations book={book} did={did} />
        </aside>
      </div>
      {Boolean(reviewsOfThisBook.length) && (
        <div className="mt-8">
          <CommentsSection book={book} did={did}>
            <h2 className="mb-5 text-2xl font-bold">Reviews</h2>
          </CommentsSection>
        </div>
      )}
    </div>
  );
};
