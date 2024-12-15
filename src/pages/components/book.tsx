import { type FC } from "hono/jsx";
import type { Book } from "../../db";
import { BOOK_STATUS_MAP } from "../../constants";
import { useRequestContext } from "hono/jsx-renderer";
import { FallbackCover } from "./fallbackCover";

export const BookList: FC<{
  books?: Book[];
}> = async ({ books: booksFromProps }) => {
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
          .limit(100)
          .execute()
      : []);

  return (
    <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {books.map((book) => (
        <BookListItem book={book} />
      ))}
    </ul>
  );
};

export const BookListItem: FC<{
  book: Book;
}> = ({ book }) => (
  <li className="group relative">
    <a
      href={`/books/${book.hiveId}`}
      className="relative mb-12 block h-72 w-48 transform cursor-pointer transition-transform duration-300 group-hover:-translate-y-2"
    >
      {book.cover || book.thumbnail ? (
        <img
          src={book.cover || book.thumbnail || ""}
          alt={book.title}
          className="h-full w-full rounded-lg object-cover shadow-lg"
        />
      ) : (
        <FallbackCover className="h-full w-full" />
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
            <span class="ms-3 rounded bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-200 dark:text-blue-800">
              {book.stars ? book.stars / 2 : "N/A"}
            </span>
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
