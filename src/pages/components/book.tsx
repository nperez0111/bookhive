/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";
import type { HiveBook, UserBook } from "../../db";
import { BOOK_STATUS_MAP } from "../../constants";

export const BookList: FC<{
  books: (UserBook & HiveBook)[];
}> = ({ books }) => (
  <ul class="flex flex-wrap space-y-4 space-x-4">
    {books.map((book) => (
      <BookListItem book={book} />
    ))}
  </ul>
);

export const BookListItem: FC<{
  book: UserBook & HiveBook;
}> = ({ book }) => (
  <li className="group relative">
    <a
      href={`/books/${book.hiveId}`}
      className="relative mb-12 block h-72 w-48 transform cursor-pointer transition-transform duration-300 group-hover:-translate-y-2"
    >
      <img
        src={book.cover || book.thumbnail}
        alt={book.title}
        className="h-full w-full rounded-lg object-cover shadow-lg"
      />
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
                        Math.min(
                          100,
                          Math.max(
                            0,
                            book.stars
                              ? (book.stars / 2 - (star - 1)) * 100
                              : ((book.rating || 0) / 1000 - (star - 1)) * 100,
                          ),
                        )
                      }% 0 0)`,
                    }}
                    class="fill-current text-yellow-400"
                    d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                  />
                </svg>
              ))}
            </div>
          </div>
          {book.status && book.status in BOOK_STATUS_MAP && (
            <span className="mt-1 mr-1 inline-block rounded-full bg-white/20 px-2 py-1 text-xs capitalize">
              {BOOK_STATUS_MAP[book.status as keyof typeof BOOK_STATUS_MAP]}
            </span>
          )}
          {book.stars && (
            <span className="mt-1 mr-1 inline-block rounded-full bg-white/20 px-2 py-1 text-xs capitalize">
              rated
            </span>
          )}
          {book.review && (
            <span className="mt-1 mr-1 inline-block rounded-full bg-white/20 px-2 py-1 text-xs capitalize">
              reviewed
            </span>
          )}
        </div>
      </div>

      <h3 className="text-md mt-2 line-clamp-2 max-w-[12rem] text-center leading-tight font-semibold text-slate-600 dark:text-white">
        {book.title}
      </h3>
    </a>
  </li>
);