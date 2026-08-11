import type { FC } from "hono/jsx";

export type LibbyPageBook = {
  hiveId: string;
  title: string;
  author: string;
  cover: string | null;
  isbn: string | null;
  isbn13: string | null;
  olWorkId: string | null;
};

export const LibbyPage: FC<{ books: LibbyPageBook[] }> = ({ books }) => {
  return (
    <div class="space-y-6 px-4 lg:px-8">
      <header class="space-y-2">
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Libby availability</h1>
        <p class="max-w-2xl text-sm text-muted-foreground">
          Cross-check your want-to-read shelf against your local library on Libby. Pick a library
          and we&apos;ll look up each book — borrow now if it&apos;s available, or place a hold. We
          never store your library selection on our servers; it lives in your browser.
        </p>
      </header>

      {books.length === 0 ? (
        <div class="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <p class="text-lg font-medium text-foreground">No want-to-read books yet.</p>
          <p class="mt-1 text-sm text-muted-foreground">
            Add some books to your want-to-read shelf and they&apos;ll show up here.
          </p>
        </div>
      ) : (
        <div
          id="mount-libby-shelf"
          data-books={JSON.stringify(books)}
          class="rounded-xl border border-border bg-card p-4"
        >
          {/* Hydrated by src/client/index.tsx → LibbyShelf. */}
          <p class="text-sm text-muted-foreground">Loading Libby availability…</p>
        </div>
      )}
    </div>
  );
};
