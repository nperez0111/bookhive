import { type Child, type FC } from "hono/jsx";
import type { Book, HiveBook } from "../../types";
import * as BookStatus from "../../bsky/lexicon/types/buzz/bookhive/defs";
import { BOOK_STATUS_MAP } from "../../constants";
import { useRequestContext } from "hono/jsx-renderer";
import { FallbackCover } from "./fallbackCover";

const NO_BOOKS_FOUND = (
  <p className="text-center text-lg">No books in this list</p>
);

export async function BookList({
  books: booksFromProps,
  fallback,
}: {
  books?: Book[];
  fallback?: Child;
}) {
  const c = useRequestContext();
  const agent = await c.get("ctx").getSessionAgent();
  const books =
    booksFromProps ||
    (agent
      ? await c
          .get("ctx")
          .db.selectFrom("user_book")
          .innerJoin("hive_book", "user_book.hiveId", "hive_book.id")
          .selectAll()
          .where("user_book.userDid", "=", agent.assertDid)
          .orderBy("user_book.createdAt", "desc")
          .limit(10_000)
          .execute()
      : []);

  function orNoResults(arr: any[]) {
    if (!arr.length) {
      return NO_BOOKS_FOUND;
    }
    return arr;
  }

  if (!books.length) {
    return fallback || NO_BOOKS_FOUND;
  }

  return (
    <div class="relative overflow-hidden rounded-lg bg-yellow-50 pb-16 dark:bg-zinc-800">
      <input
        type="radio"
        id="tab-read"
        name="tabs"
        class="peer/read hidden"
        checked
      />
      <input type="radio" id="tab-want" name="tabs" class="peer/want hidden" />
      <input
        type="radio"
        id="tab-reading"
        name="tabs"
        class="peer/reading hidden"
      />

      <div class="mb-4 border-b border-gray-200 dark:border-gray-700 peer-checked/read:[&_label[for='tab-read']]:border-yellow-600 peer-checked/read:[&_label[for='tab-read']]:text-yellow-600 peer-checked/reading:[&_label[for='tab-reading']]:border-yellow-600 peer-checked/reading:[&_label[for='tab-reading']]:text-yellow-600 peer-checked/want:[&_label[for='tab-want']]:border-yellow-600 peer-checked/want:[&_label[for='tab-want']]:text-yellow-600">
        <ul
          class="-mb-px flex flex-wrap text-center text-sm font-medium"
          role="tablist"
        >
          <li class="me-2" role="presentation">
            <label
              for="tab-read"
              role="tab"
              aria-selected="true"
              aria-controls="tab-read-panel"
              class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Read
            </label>
          </li>
          <li class="me-2" role="presentation">
            <label
              for="tab-reading"
              role="tab"
              aria-selected="false"
              aria-controls="tab-reading-panel"
              class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Reading
            </label>
          </li>
          <li class="me-2" role="presentation">
            <label
              for="tab-want"
              role="tab"
              aria-selected="false"
              aria-controls="tab-want-panel"
              class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Want to Read
            </label>
          </li>
        </ul>
      </div>

      <div
        id="tab-read-panel"
        role="tabpanel"
        aria-labelledby="tab-read"
        class="mt-8 hidden peer-checked/read:block"
      >
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {orNoResults(
            books
              .filter((book) => book.status === BookStatus.FINISHED)
              .map((book) => <BookListItem book={book} />),
          )}
        </ul>
      </div>
      <div
        id="tab-reading-panel"
        role="tabpanel"
        aria-labelledby="tab-reading"
        class="mt-8 hidden peer-checked/reading:block"
      >
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {orNoResults(
            books
              .filter((book) => book.status === BookStatus.READING)
              .map((book) => <BookListItem book={book} />),
          )}
        </ul>
      </div>
      <div
        id="tab-want-panel"
        role="tabpanel"
        aria-labelledby="tab-want"
        class="mt-8 hidden peer-checked/want:block"
      >
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {orNoResults(
            books
              .filter((book) => book.status === BookStatus.WANTTOREAD)
              .map((book) => <BookListItem book={book} />),
          )}
        </ul>
      </div>
    </div>
  );
}

export const BookListItem: FC<{
  book: Book | HiveBook;
}> = ({ book }) => {
  const hiveId = "hiveId" in book ? book.hiveId : book.id;
  const rating =
    "stars" in book && book.stars !== null
      ? book.stars / 2
      : "rating" in book
        ? book.rating || 0
        : 0;
  return (
    <li className="group relative flex justify-center">
      <a
        href={`/books/${hiveId}`}
        className="relative mb-12 block h-72 w-48 transform cursor-pointer transition-transform duration-300 group-hover:-translate-y-2"
      >
        {book.cover || book.thumbnail ? (
          <img
            src={`${book.cover || book.thumbnail || ""}`}
            // src={`/images/w_300/${book.cover || book.thumbnail || ""}`}
            alt={book.title}
            className="book-cover h-full w-full rounded-lg object-cover shadow-lg transition-all duration-300 group-hover:saturate-60"
            style={`--book-cover-name: book-cover-${hiveId}`}
            loading="lazy"
          />
        ) : (
          <FallbackCover
            className="book-cover h-full w-full transition-all duration-300 group-hover:saturate-60"
            style={`--book-cover-name: book-cover-${hiveId}`}
          />
        )}
        <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <div className="absolute bottom-0 p-4 text-white">
            <p className="text-md font-bold">
              {book.authors.split("\t").join(", ")}
            </p>
            <div className="flex items-center">
              <div className="-ml-1 flex -space-x-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <svg
                    class="relative inline-flex w-6"
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
                        clipPath: `inset(0 ${
                          100 -
                          Math.min(100, Math.max(0, rating - (star - 1) * 100))
                        }% 0 0)`,
                      }}
                      class="fill-current text-yellow-400"
                      d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                    />
                  </svg>
                ))}
              </div>
              <span class="ms-3 rounded bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-200 dark:text-blue-800">
                {rating ? rating : "N/A"}
              </span>
            </div>
            {"status" in book &&
              book.status !== null &&
              book.status in BOOK_STATUS_MAP && (
                <span className="mt-1 mr-1 inline-block rounded-full bg-white/20 px-2 py-1 text-xs capitalize">
                  {BOOK_STATUS_MAP[book.status as keyof typeof BOOK_STATUS_MAP]}
                </span>
              )}
            {"stars" in book && book.stars !== null && (
              <span className="mt-1 mr-1 inline-block rounded-full bg-white/20 px-2 py-1 text-xs capitalize">
                rated
              </span>
            )}
            {"review" in book && book.review !== null && (
              <span className="mt-1 mr-1 inline-block rounded-full bg-white/20 px-2 py-1 text-xs capitalize">
                reviewed
              </span>
            )}
          </div>
        </div>

        <h3
          className="book-title text-md mt-2 line-clamp-2 max-w-[12rem] text-center leading-tight font-semibold text-slate-600 dark:text-white"
          style={`--book-title-name: book-title-${hiveId}`}
        >
          {book.title}
        </h3>
      </a>
    </li>
  );
};
