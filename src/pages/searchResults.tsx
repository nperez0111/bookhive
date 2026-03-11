import { type FC } from "hono/jsx";
import type { HiveBook } from "../types";
import { BookListItem } from "./components/book";

interface SearchResultsProps {
  query: string;
  books: HiveBook[];
  currentPage: number;
  totalPages: number;
  totalBooks: number;
  pageSize: number;
}

const ChevronLeft = () => (
  <svg class="size-5" fill="currentColor" viewBox="0 0 20 20">
    <path
      fill-rule="evenodd"
      d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
      clip-rule="evenodd"
    />
  </svg>
);

const ChevronRight = () => (
  <svg class="size-5" fill="currentColor" viewBox="0 0 20 20">
    <path
      fill-rule="evenodd"
      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
      clip-rule="evenodd"
    />
  </svg>
);

export const SearchResults: FC<SearchResultsProps> = ({
  query,
  books,
  currentPage,
  totalPages,
  totalBooks,
  pageSize,
}) => {
  const start = totalBooks === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalBooks);

  return (
    <div class="space-y-6">
      <nav class="text-muted-foreground flex items-center gap-2 text-sm" aria-label="Breadcrumb">
        <a href="/" class="hover:text-foreground transition-colors">
          Home
        </a>
        <span aria-hidden="true">›</span>
        <span class="text-foreground font-medium">Search</span>
      </nav>

      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
          {query ? <>Results for "{query}"</> : "Search"}
        </h1>
        {totalBooks > 0 && (
          <p class="text-muted-foreground mt-2 text-sm">
            Showing {start}–{end} of {totalBooks} books
          </p>
        )}
      </div>

      {/* Search form for refining query */}
      <form method="get" action="/search" class="flex gap-2">
        <input
          type="search"
          name="q"
          value={query}
          placeholder="Search books..."
          class="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          autofocus={!query}
        />
        <button type="submit" class="btn btn-primary btn-sm">
          Search
        </button>
      </form>

      {!query && (
        <div class="card">
          <section class="py-12 text-center">
            <p class="text-muted-foreground">Enter a search term to find books.</p>
          </section>
        </div>
      )}

      {query && books.length === 0 && (
        <div class="card">
          <section class="py-12 text-center">
            <h3 class="text-xl font-semibold text-foreground">No results found</h3>
            <p class="text-muted-foreground mt-2">
              No books found for "{query}". Try a different search term.
            </p>
          </section>
        </div>
      )}

      {books.length > 0 && (
        <>
          <div class="card">
            <section>
              <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {books.map((book) => (
                  <BookListItem book={book} />
                ))}
              </ul>
            </section>
          </div>

          {totalPages > 1 && (
            <nav class="flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
              {currentPage > 1 ? (
                <a
                  href={`/search?q=${encodeURIComponent(query)}&page=${currentPage - 1}`}
                  class="btn btn-sm btn-ghost"
                >
                  <span class="sr-only">Previous</span>
                  <ChevronLeft />
                </a>
              ) : (
                <span class="btn btn-sm btn-ghost opacity-50" aria-disabled="true">
                  <span class="sr-only">Previous</span>
                  <ChevronLeft />
                </span>
              )}

              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                const isCurrentPage = pageNum === currentPage;
                return (
                  <a
                    href={`/search?q=${encodeURIComponent(query)}&page=${pageNum}`}
                    class={`btn btn-sm ${isCurrentPage ? "btn-primary" : "btn-ghost"}`}
                    aria-current={isCurrentPage ? "page" : undefined}
                  >
                    {pageNum}
                  </a>
                );
              })}

              {currentPage < totalPages ? (
                <a
                  href={`/search?q=${encodeURIComponent(query)}&page=${currentPage + 1}`}
                  class="btn btn-sm btn-ghost"
                >
                  <span class="sr-only">Next</span>
                  <ChevronRight />
                </a>
              ) : (
                <span class="btn btn-sm btn-ghost opacity-50" aria-disabled="true">
                  <span class="sr-only">Next</span>
                  <ChevronRight />
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
};
