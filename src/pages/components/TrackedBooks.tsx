import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { Book } from "../../types";
import { normalizeBookMeta } from "../../core/bookMeta";
import { LibraryTable } from "../../client/components/LibraryTable";

/** Paint the same workspace the island enhances; no-JS book links remain navigable. */
export const TrackedBooks: FC<{ books: Book[] }> = ({ books }) => {
  const initialBooks = books.map((b) => ({
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
    totalPages: b.bookProgress?.totalPages ?? normalizeBookMeta(b.meta).numPages ?? null,
  }));
  return (
    <div id="mount-library-table" data-books={JSON.stringify(initialBooks)}>
      <noscript>
        <style>
          {raw(`
          #mount-library-table .library-toolbar,
          #mount-library-table .library-grid-actions,
          #mount-library-table .library-js-only { display: none; }
        `)}
        </style>
        <p class="mb-6 text-sm text-muted-foreground">
          {books.length} books. Open a book to view or edit its details.
        </p>
      </noscript>
      <LibraryTable initialBooks={initialBooks} initialView="responsive" interactive={false} />
    </div>
  );
};
