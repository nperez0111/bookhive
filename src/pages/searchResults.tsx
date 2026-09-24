import { type FC } from "hono/jsx";
import type { HiveBook } from "../types";
import { BookCard, normalizeBookData } from "./components/BookCard";
import { Pagination } from "./components/Pagination";
import { LanguageSelect } from "./components/LanguageSelect";
import { Script } from "./utils/script";

interface SearchResultsProps {
  query: string;
  books: HiveBook[];
  currentPage: number;
  totalPages: number;
  totalBooks: number;
  pageSize: number;
  lang?: string;
  languages: string[];
}

export const SearchResults: FC<SearchResultsProps> = ({
  query,
  books,
  currentPage,
  totalPages,
  totalBooks,
  pageSize,
  lang,
  languages,
}) => {
  const start = totalBooks === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalBooks);

  return (
    <div class="space-y-6">
      <nav class="text-muted-foreground flex items-center gap-2 text-sm" aria-label="Breadcrumb">
        <a href="/" class="hover:text-foreground transition-[color] duration-150">
          Home
        </a>
        <span aria-hidden="true">›</span>
        <span class="text-foreground font-medium">Search</span>
      </nav>

      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
            {query ? <>Results for "{query}"</> : "Search"}
          </h1>
          {totalBooks > 0 && (
            <p class="text-muted-foreground mt-2 text-sm tabular-nums">
              Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
              {totalBooks.toLocaleString()} books
            </p>
          )}
        </div>
        <LanguageSelect
          languages={languages}
          currentLang={lang}
          baseUrl="/search"
          extraParams={{ q: query || undefined }}
        />
      </div>

      {/* Search form for refining query */}
      <form method="get" action="/search" class="flex gap-2">
        <input
          type="search"
          name="q"
          value={query}
          placeholder="Search books..."
          class="input focus-ring flex-1"
          autofocus={!query}
        />
        <input type="hidden" name="lang" id="search-lang-input" value={lang || ""} />
        <button type="submit" class="btn btn-primary">
          Search
        </button>
      </form>
      <Script
        script={(document) => {
          const langInput = document.getElementById("search-lang-input") as HTMLInputElement;
          if (!langInput) return;
          // Sync with localStorage preference if not already set by server
          if (!langInput.value) {
            const stored = localStorage.getItem("preferred_language");
            if (stored) langInput.value = stored;
          }
        }}
      />

      {!query && (
        <div class="card">
          <div class="empty">
            <h3 class="empty-title">Search for a book</h3>
            <p class="empty-description">
              Look up any title, author or ISBN — or browse by genre if you're not sure yet.
            </p>
            <a href="/explore" class="btn btn-outline mt-4 min-h-10">
              Explore books
            </a>
          </div>
        </div>
      )}

      {query && books.length === 0 && (
        <div class="card">
          <div class="empty">
            <h3 class="empty-title">No results found</h3>
            <p class="empty-description">
              No books found for "{query}". Try a different spelling, search by author, or browse by
              genre.
            </p>
            <a href="/explore/genres" class="btn btn-outline mt-4 min-h-10">
              Browse genres
            </a>
          </div>
        </div>
      )}

      {books.length > 0 && (
        <>
          <div class="card">
            <section>
              <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {books.map((book) => (
                  <BookCard variant="dense" showAuthor book={normalizeBookData(book)} />
                ))}
              </ul>
            </section>
          </div>

          <Pagination
            basePath="/search"
            currentPage={currentPage}
            totalPages={totalPages}
            params={{ q: query, lang }}
          />
        </>
      )}
    </div>
  );
};
