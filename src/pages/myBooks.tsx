import type { FC } from "hono/jsx";
import type { Book } from "../types";
import { TrackedBooks } from "./components/TrackedBooks";

export const MyBooks: FC<{ books: Book[]; handle: string }> = ({ books, handle }) => (
  <div class="space-y-6 px-4 py-6 lg:px-8">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-foreground text-3xl font-bold tracking-tight">My Books</h1>
        <p class="text-muted-foreground mt-2">Your reading, all in one place.</p>
      </div>
      <a href="/import" class="btn btn-outline min-h-10">
        Import books
      </a>
    </div>
    <nav aria-label="Book management" class="flex flex-wrap gap-2">
      <a href={`/shelves/${handle}`} class="btn btn-ghost min-h-10">
        Shelves
      </a>
      <a href={`/profile/${handle}/stats`} class="btn btn-ghost min-h-10">
        Reading stats
      </a>
      <a href="/library" class="btn btn-ghost min-h-10">
        Ebooks &amp; Devices
      </a>
    </nav>
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
