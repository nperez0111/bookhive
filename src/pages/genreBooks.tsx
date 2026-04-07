import { type FC } from "hono/jsx";
import { sql } from "kysely";
import type { HiveBook } from "../types";
import { BookCard, normalizeBookData } from "./components/BookCard";
import { endTime, startTime } from "hono/timing";
import type { AppContext } from "../context";
import type { Context } from "hono";

type SortOption = "popularity" | "relevance" | "reviews";

interface GenreBooksProps {
  genre: string;
  books: HiveBook[];
  currentPage: number;
  totalPages: number;
  totalBooks: number;
  sortBy: SortOption;
  pageSize: number;
}

const sorts = [
  { key: "popularity" as const, label: "Popularity" },
  { key: "relevance" as const, label: "Relevance" },
  { key: "reviews" as const, label: "Reviews" },
];

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

const NO_BOOKS_FOUND = (genre: string) => (
  <div class="card">
    <section class="py-12 text-center">
      <h3 class="text-xl font-semibold text-foreground">No books found</h3>
      <p class="text-muted-foreground mt-2">No books found in the "{genre}" genre yet.</p>
    </section>
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
        <a href="/explore" class="hover:text-foreground transition-colors">
          Explore
        </a>
        <span aria-hidden="true">›</span>
        <a href="/explore/genres" class="hover:text-foreground transition-colors">
          Genres
        </a>
        <span aria-hidden="true">›</span>
        <span class="text-foreground font-medium">{genre}</span>
      </nav>

      <div class="flex flex-col gap-4">
        <h1
          class="genre-name text-3xl font-bold tracking-tight text-foreground lg:text-4xl"
          style={`--genre-name: genre-${genre}`}
        >
          {genre}
        </h1>

        {books.length > 0 && (
          <div class="mb-4 flex flex-wrap items-center gap-2">
            {sorts.map((s) => (
              <a
                href={`/explore/genres/${encodeURIComponent(genre)}?sort=${s.key}&page=1`}
                class={`btn btn-sm ${sortBy === s.key ? "btn-primary" : "btn-ghost"}`}
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
            <p class="text-muted-foreground text-sm">
              Showing {start}-{end} of {totalBooks} books
            </p>

            <div class="card">
              <section>
                <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {books.map((book) => (
                    <BookCard variant="dense" book={normalizeBookData(book)} />
                  ))}
                </ul>
              </section>
            </div>

            {totalPages > 1 && (
              <nav class="flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
                {currentPage > 1 ? (
                  <a
                    href={`/explore/genres/${encodeURIComponent(genre)}?sort=${sortBy}&page=${currentPage - 1}`}
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
                      href={`/explore/genres/${encodeURIComponent(genre)}?sort=${sortBy}&page=${pageNum}`}
                      class={`btn btn-sm ${isCurrentPage ? "btn-primary" : "btn-ghost"}`}
                      aria-current={isCurrentPage ? "page" : undefined}
                    >
                      {pageNum}
                    </a>
                  );
                })}

                {currentPage < totalPages ? (
                  <a
                    href={`/explore/genres/${encodeURIComponent(genre)}?sort=${sortBy}&page=${currentPage + 1}`}
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
    </div>
  );
};

export async function getBooksByGenre(
  genre: string,
  ctx: AppContext,
  page: number = 1,
  pageSize: number = 20,
  sortBy: SortOption = "popularity",
  c: Context,
): Promise<{
  books: HiveBook[];
  totalBooks: number;
  totalPages: number;
  currentPage: number;
}> {
  const offset = (page - 1) * pageSize;

  startTime(c, "genre-books-count-query");
  startTime(c, "genre-books-data-query");

  let dataQuery = ctx.db
    .selectFrom("hive_book")
    .innerJoin("hive_book_genre", "hive_book.id", "hive_book_genre.hiveId")
    .selectAll("hive_book")
    .where("hive_book_genre.genre", "=", genre);

  switch (sortBy) {
    case "popularity":
      dataQuery = dataQuery
        .orderBy("hive_book.ratingsCount", "desc")
        .orderBy("hive_book.rating", "desc");
      break;
    case "relevance":
      // Lower id ≈ earlier in scraped genre list (syncHiveBookGenres insert order).
      dataQuery = dataQuery.orderBy(
        sql`(SELECT MIN(id) FROM hive_book_genre WHERE "hiveId" = hive_book.id AND genre = ${genre})`,
        "asc",
      );
      break;
    case "reviews":
      dataQuery = dataQuery
        .orderBy("hive_book.rating", "desc")
        .orderBy("hive_book.ratingsCount", "desc");
      break;
  }

  const [totalCountResult, books] = await Promise.all([
    ctx.db
      .selectFrom("hive_book_genre")
      .select(sql<number>`COUNT(DISTINCT hiveId)`.as("count"))
      .where("genre", "=", genre)
      .executeTakeFirst()
      .then((r) => {
        endTime(c, "genre-books-count-query");
        return r;
      }),
    dataQuery
      .limit(pageSize)
      .offset(offset)
      .execute()
      .then((r) => {
        endTime(c, "genre-books-data-query");
        return r;
      }),
  ]);

  const totalBooks = totalCountResult?.count ?? 0;
  const totalPages = Math.ceil(totalBooks / pageSize);

  return {
    books,
    totalBooks,
    totalPages,
    currentPage: page,
  };
}
