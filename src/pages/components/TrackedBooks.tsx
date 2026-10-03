import type { FC } from "hono/jsx";
import type { Book } from "../../types";
import { normalizeBookMeta } from "../../core/bookMeta";
import { BookCard, normalizeBookData } from "./BookCard";

/** My Books workspace mount with a no-JS cover-grid fallback. */
export const TrackedBooks: FC<{ books: Book[] }> = ({ books }) => (
  <div
    id="mount-library-table"
    data-books={JSON.stringify(
      books.map((b) => {
        const metaPages = normalizeBookMeta(b.meta).numPages ?? null;
        return {
          hiveId: b.hiveId,
          title: b.title,
          authors: b.authors,
          cover: b.cover,
          thumbnail: b.thumbnail,
          status: b.status,
          stars: b.stars,
          startedAt: b.startedAt,
          finishedAt: b.finishedAt,
          createdAt: b.createdAt,
          owned: b.owned,
          review: b.review,
          bookProgress: b.bookProgress,
          totalPages: b.bookProgress?.totalPages ?? metaPages,
        };
      }),
    )}
  >
    {/* Pre-hydration paint and the no-JS fallback — LibraryTable replaces this on hydration. */}
    <ul class="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 xl:grid-cols-6 2xl:grid-cols-7">
      {books.map((book) => (
        <li class="min-w-0">
          <BookCard variant="dense" showAuthor reserveTextSpace book={normalizeBookData(book)} />
        </li>
      ))}
    </ul>
  </div>
);
