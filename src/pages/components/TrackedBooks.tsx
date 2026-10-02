import type { FC } from "hono/jsx";
import type { Book } from "../../types";
import { normalizeBookMeta } from "../../core/bookMeta";
import { BookCard, normalizeBookData } from "./BookCard";

/** Shared editable library island for My Books and the owner's profile. */
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
    <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {books.map((book) => (
        <BookCard variant="dense" showAuthor book={normalizeBookData(book)} />
      ))}
    </ul>
  </div>
);
