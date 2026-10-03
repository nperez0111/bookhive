import type { FC } from "hono/jsx";
import type { Book } from "../types";
import { TrackedBooks } from "./components/TrackedBooks";

export const MyBooks: FC<{ books: Book[] }> = ({ books }) => (
  <div class="space-y-6 px-4 py-6 lg:px-8">
    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
      <h1 class="text-foreground text-3xl font-bold tracking-tight">My Books</h1>
      <a href="/import" class="btn btn-outline min-h-10">
        Import books
      </a>
      <p class="text-muted-foreground col-span-2">
        Find, organize, and update the books you track.
      </p>
    </div>
    {books.length ? (
      <TrackedBooks books={books} />
    ) : (
      <div class="card empty">
        <h2 class="empty-title">Your reading starts here</h2>
        <p class="empty-description">
          Find your first book, or bring your reading history with you.
        </p>
        <div class="mt-4 flex flex-wrap justify-center gap-3">
          <a href="/search" class="btn btn-primary min-h-10">
            Find a book
          </a>
          <a href="/import" class="btn btn-outline min-h-10">
            Import books
          </a>
        </div>
      </div>
    )}
  </div>
);
