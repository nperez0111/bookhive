import { viewTransitionName } from "../lib/viewTransitionName";
import { type FC } from "hono/jsx";
import type { HiveBook } from "../types";
import { BookCard, normalizeBookData } from "./components/BookCard";
import { LanguageSelect } from "./components/LanguageSelect";
import { buildUrl } from "../lib/buildUrl";
import { Pagination } from "./components/Pagination";

type SortOption = "popularity" | "relevance" | "reviews";

interface GenreBooksProps {
  genre: string;
  books: HiveBook[];
  currentPage: number;
  totalPages: number;
  totalBooks: number;
  sortBy: SortOption;
  pageSize: number;
  lang?: string;
  languages: string[];
}

const sorts = [
  { key: "popularity" as const, label: "Popularity" },
  { key: "relevance" as const, label: "Relevance" },
  { key: "reviews" as const, label: "Reviews" },
];

const NO_BOOKS_FOUND = (genre: string) => (
  <div class="card">
    <div class="empty">
      <h3 class="empty-title">No books found</h3>
      <p class="empty-description">No books found in the "{genre}" genre yet.</p>
      <a href="/explore/genres" class="btn btn-outline mt-4 min-h-10">
        Browse all genres
      </a>
    </div>
  </div>
);

export const GenreBooks: FC<GenreBooksProps> = ({
  genre,
  books,
  currentPage,
  totalPages,
  totalBooks,
  sortBy,
  pageSize,
  lang,
  languages,
}) => {
  const start = totalBooks === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalBooks);
  const basePath = `/explore/genres/${encodeURIComponent(genre)}`;

  return (
    <div class="space-y-6">
      <nav class="text-muted-foreground flex items-center gap-2 text-sm" aria-label="Breadcrumb">
        <a href="/" class="hover:text-foreground transition-colors">
          Home
        </a>
        <span aria-hidden="true">›</span>
        <a href={buildUrl("/explore", { lang })} class="hover:text-foreground transition-colors">
          Explore
        </a>
        <span aria-hidden="true">›</span>
        <a
          href={buildUrl("/explore/genres", { lang })}
          class="hover:text-foreground transition-colors"
        >
          Genres
        </a>
        <span aria-hidden="true">›</span>
        <span class="text-foreground font-medium">{genre}</span>
      </nav>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1
            class="genre-name text-3xl font-bold tracking-tight text-foreground lg:text-4xl"
            style={`--genre-name: ${viewTransitionName("genre", genre)}`}
          >
            {genre}
          </h1>
          <LanguageSelect
            languages={languages}
            currentLang={lang}
            baseUrl={basePath}
            extraParams={{ sort: sortBy }}
          />
        </div>

        {books.length > 0 && (
          <div class="mb-4 flex flex-wrap items-center gap-2">
            {sorts.map((s) => (
              <a
                href={buildUrl(basePath, { sort: s.key, page: "1", lang })}
                class={`btn btn-sm min-h-10 ${sortBy === s.key ? "btn-primary" : "btn-ghost"}`}
              >
                {s.label}
              </a>
            ))}
          </div>
        )}

        {books.length === 0 ? (
          NO_BOOKS_FOUND(genre)
        ) : (
          <>
            <p class="text-muted-foreground tabular-nums text-sm">
              Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
              {totalBooks.toLocaleString()} books
            </p>

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
              basePath={basePath}
              currentPage={currentPage}
              totalPages={totalPages}
              params={{ sort: sortBy, lang }}
            />
          </>
        )}
      </div>
    </div>
  );
};
