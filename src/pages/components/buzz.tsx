import { type FC } from "hono/jsx";
import { formatDistanceToNow } from "date-fns";
import * as BookStatus from "../../bsky/lexicon/types/buzz/bookhive/defs";
import { BOOK_STATUS_PAST_TENSE_MAP } from "../../constants";
import { FallbackCover } from "./fallbackCover";
import type { Book } from "../../types";

export const BuzzSection: FC<{
  title: string;
  subtitle: string;
  books: Book[];
  didHandleMap: Record<string, string>;
}> = ({ title, subtitle, books, didHandleMap }) => {
  return (
    <div class="mt-16 flex flex-col gap-2 px-4 lg:px-8">
      <div class="mb-6">
        <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
          {title}
        </h2>
        <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
          {subtitle}
        </p>
      </div>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {books.map((book) => (
          <BuzzBook 
            key={`${book.userDid}-${book.hiveId}`}
            book={book} 
            userHandle={didHandleMap[book.userDid] || book.userDid} 
          />
        ))}
      </div>
    </div>
  );
};

export const BuzzBook: FC<{
  book: Book;
  userHandle: string;
}> = ({ book, userHandle }) => {
  return (
    <div class="group rounded-lg border border-gray-200 bg-yellow-50 shadow dark:border-gray-700 dark:bg-zinc-800">
      <a
        href={`/books/${book.hiveId}`}
        class="block h-72 w-full rounded-md transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg"
      >
        {book.cover || book.thumbnail ? (
          <img
            src={`${book.cover || book.thumbnail || ""}`}
            alt={book.title}
            className="book-cover h-full w-full rounded-lg object-cover"
            style={`--book-cover-name: book-cover-${book.hiveId}`}
          />
        ) : (
          <FallbackCover 
            className="book-cover h-full w-full" 
            style={`--book-cover-name: book-cover-${book.hiveId}`}
          />
        )}
      </a>

      <a
        href={`/profile/${userHandle}`}
        class="cursor-pointer"
      >
        <div class="mt-5 px-3 pb-5">
          <h5 class="book-title line-clamp-2 text-xl font-semibold tracking-tight text-gray-900 dark:text-white" style={`--book-title-name: book-title-${book.hiveId}`}>
            {book.title}
          </h5>
          <div className="flex items-center">
            <div className="-ml-1 flex -space-x-1.5">
              {book.stars &&
                [1, 2, 3, 4, 5].map((star) => (
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
                              ((book.stars || 0) / 2 - (star - 1)) * 100,
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
            {book.stars && (
              <span class="ms-3 rounded bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-200 dark:text-blue-800">
                {book.stars / 2}
              </span>
            )}
          </div>
          <span class="line-clamp-1 block font-semibold text-ellipsis">
            @{userHandle}
          </span>
          {book.status && book.status in BOOK_STATUS_PAST_TENSE_MAP
            ? BOOK_STATUS_PAST_TENSE_MAP[
                book.status as keyof typeof BOOK_STATUS_PAST_TENSE_MAP
              ]
            : book.status ||
              BOOK_STATUS_PAST_TENSE_MAP[BookStatus.READING]}{" "}
          <span class="text-slate-700 dark:text-slate-200">
            {formatDistanceToNow(book.indexedAt, { addSuffix: true })}
          </span>
          {book.review && book.review.length > 0 && (
            <span> and reviewed it</span>
          )}
        </div>
      </a>
    </div>
  );
};