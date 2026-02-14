import { type FC } from "hono/jsx";
import { sql } from "kysely";
import type { HiveBook } from "../types";
import { BookListItem } from "./components/book";
import { endTime, startTime } from "hono/timing";
import type { AppContext } from "..";
import type { Context } from "hono";

type SortOption = "popularity" | "relevance" | "reviews";

interface GenreBooksProps {
  genre: string;
  books: HiveBook[];
  currentPage: number;
  totalPages: number;
  totalBooks: number;
  sortBy: SortOption;
}

const NO_BOOKS_FOUND = (genre: string) => (
  <div class="rounded-xl border border-gray-200 bg-yellow-50 px-8 py-12 text-center dark:border-gray-700 dark:bg-zinc-800">
    <h3 class="text-xl font-semibold text-gray-700 dark:text-gray-300">
      No books found
    </h3>
    <p class="mt-2 text-gray-600 dark:text-gray-400">
      No books found in the "{genre}" genre yet.
    </p>
  </div>
);

export const GenreBooks: FC<GenreBooksProps> = ({
  genre,
  books,
  currentPage,
  totalPages,
  totalBooks,
  sortBy,
}) => {
  return (
    <div class="bg-sand container mx-auto max-w-7xl dark:bg-zinc-900 dark:text-white">
      <div class="flex flex-col gap-2 px-4 py-16 lg:px-8">
        {/* Breadcrumb navigation */}
        <nav class="mb-4">
          <ol class="flex items-center space-x-2 text-sm">
            <li>
              <a
                href="/genres"
                class="text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300"
              >
                Genres
              </a>
            </li>
            <li class="text-gray-400 dark:text-gray-500">/</li>
            <li class="text-gray-700 dark:text-gray-300">{genre}</li>
          </ol>
        </nav>

        {/* Header with title and sort options */}
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="flex-1">
            <h1
              class="genre-name text-4xl font-bold lg:text-5xl lg:tracking-tight"
              style={`--genre-name: genre-${genre}`}
            >
              {genre}
            </h1>
            <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
              {totalBooks} book{totalBooks !== 1 ? "s" : ""} in this genre
            </p>
          </div>

          {/* Sort Options */}
          {books.length > 0 && (
            <div class="flex flex-wrap items-center gap-2 lg:flex-nowrap">
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Sort by:
              </span>
              <div class="flex flex-wrap gap-2">
                {(["popularity", "relevance", "reviews"] as const).map(
                  (sort) => (
                    <a
                      href={`/genres/${encodeURIComponent(genre)}?sort=${sort}&page=1`}
                      class={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        sortBy === sort
                          ? "bg-yellow-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700"
                      } border border-gray-300 dark:border-gray-600`}
                    >
                      {sort === "popularity" && "Popularity"}
                      {sort === "relevance" && "Relevance"}
                      {sort === "reviews" && "Reviews"}
                    </a>
                  ),
                )}
              </div>
            </div>
          )}
        </div>

        {books.length === 0 ? (
          NO_BOOKS_FOUND(genre)
        ) : (
          <div class="mt-8">
            <div class="relative overflow-hidden rounded-lg bg-yellow-50 pb-16 dark:bg-zinc-800">
              <ul class="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {books.map((book) => (
                  <BookListItem book={book} />
                ))}
              </ul>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div class="mt-8 flex items-center justify-center">
                <nav
                  class="flex items-center space-x-2"
                  aria-label="Pagination"
                >
                  {/* Previous button */}
                  {currentPage > 1 ? (
                    <a
                      href={`/genres/${encodeURIComponent(genre)}?sort=${sortBy}&page=${currentPage - 1}`}
                      class="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700"
                    >
                      <span class="sr-only">Previous</span>
                      <svg
                        class="h-5 w-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </a>
                  ) : (
                    <span class="relative inline-flex items-center rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-400 dark:border-gray-600 dark:bg-zinc-700 dark:text-gray-500">
                      <span class="sr-only">Previous</span>
                      <svg
                        class="h-5 w-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </span>
                  )}

                  {/* Page numbers */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
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
                        key={pageNum}
                        href={`/genres/${encodeURIComponent(genre)}?sort=${sortBy}&page=${pageNum}`}
                        class={`relative inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${
                          isCurrentPage
                            ? "z-10 bg-yellow-600 text-white focus:z-20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
                            : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700"
                        }`}
                        aria-current={isCurrentPage ? "page" : undefined}
                      >
                        {pageNum}
                      </a>
                    );
                  })}

                  {/* Next button */}
                  {currentPage < totalPages ? (
                    <a
                      href={`/genres/${encodeURIComponent(genre)}?sort=${sortBy}&page=${currentPage + 1}`}
                      class="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700"
                    >
                      <span class="sr-only">Next</span>
                      <svg
                        class="h-5 w-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </a>
                  ) : (
                    <span class="relative inline-flex items-center rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-400 dark:border-gray-600 dark:bg-zinc-700 dark:text-gray-500">
                      <span class="sr-only">Next</span>
                      <svg
                        class="h-5 w-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </span>
                  )}
                </nav>
              </div>
            )}
          </div>
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
  const totalCountResult = await ctx.db
    .selectFrom("hive_book_genre")
    .select(sql<number>`COUNT(DISTINCT hiveId)`.as("count"))
    .where("genre", "=", genre)
    .executeTakeFirst();
  endTime(c, "genre-books-count-query");

  const totalBooks = totalCountResult?.count ?? 0;
  const totalPages = Math.ceil(totalBooks / pageSize);

  startTime(c, "genre-books-data-query");
  let query = ctx.db
    .selectFrom("hive_book")
    .innerJoin("hive_book_genre", "hive_book.id", "hive_book_genre.hiveId")
    .selectAll("hive_book")
    .where("hive_book_genre.genre", "=", genre);

  switch (sortBy) {
    case "popularity":
      query = query
        .orderBy("hive_book.ratingsCount", "desc")
        .orderBy("hive_book.rating", "desc");
      break;
    case "relevance":
      query = query.orderBy(
        sql`(
          SELECT CAST(key AS INTEGER) FROM json_each(hive_book.genres)
          WHERE value = ${genre}
        )`,
        "asc",
      );
      break;
    case "reviews":
      query = query
        .orderBy("hive_book.rating", "desc")
        .orderBy("hive_book.ratingsCount", "desc");
      break;
  }

  const books = await query.limit(pageSize).offset(offset).execute();
  endTime(c, "genre-books-data-query");

  return {
    books,
    totalBooks,
    totalPages,
    currentPage: page,
  };
}
