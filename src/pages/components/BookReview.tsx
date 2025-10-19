import { type FC } from "hono/jsx";
import type { Book } from "../../types";
import { FallbackCover } from "./fallbackCover";

export const BookReview: FC<{
  book: Book;
}> = ({ book }) => {
  return (
    <div class="group mb-2 cursor-pointer rounded-lg border border-slate-200 bg-yellow-50 p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-zinc-800">
      <a href={`/books/${book.hiveId}`} class="flex gap-4">
        {book.cover || book.thumbnail ? (
          <img
            src={`${book.cover || book.thumbnail || ""}`}
            alt=""
            class="book-cover h-36 w-24 rounded-lg object-cover shadow-sm"
            style={`--book-cover-name: book-cover-${book.hiveId}`}
          />
        ) : (
          <FallbackCover 
            className="book-cover h-36 w-24" 
            style={`--book-cover-name: book-cover-${book.hiveId}`}
          />
        )}
        <span class="flex flex-col gap-1">
          <span class="book-title text-lg font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400" style={`--book-title-name: book-title-${book.hiveId}`}>
            {book.title}
          </span>
          <span class="text-sm text-slate-600 dark:text-slate-400">
            by {book.authors.split("\t").join(", ")}
            {book.stars ? (
              <span class="text-md mx-1 text-slate-800 dark:text-slate-200">
                ({book.stars / 2} ⭐)
              </span>
            ) : null}
          </span>
          <p class="py-2">{book.review}</p>
        </span>
      </a>
    </div>
  );
};
