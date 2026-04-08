import { type FC } from "hono/jsx";
import { sql } from "kysely";
import type { HiveBook } from "../types";
import { BookCard, normalizeBookData } from "./components/BookCard";
import { endTime, startTime } from "hono/timing";
import type { AppContext } from "../context";
import type { Context } from "hono";
import { buildAuthorLikePatterns } from "../utils/authorMatching";

type SortOption = "popularity" | "reviews";

interface AuthorBooksProps {
  author: string;
  books: HiveBook[];
  currentPage: number;
  totalPages: number;
  totalBooks: number;
  sortBy: SortOption;
  pageSize: number;
}

const sorts = [
  { key: "popularity" as const, label: "Popularity" },
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

const NO_BOOKS_FOUND = (author: string) => (
  <div class="card">
    <section class="py-12 text-center">
      <h3 class="text-xl font-semibold text-foreground">No books found</h3>
      <p class="text-muted-foreground mt-2">No books found by "{author}" yet.</p>
    </section>
  </div>
);

export const AuthorBooks: FC<AuthorBooksProps> = ({
  author,
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
        <a href="/explore/authors" class="hover:text-foreground transition-colors">
          Authors
        </a>
        <span aria-hidden="true">›</span>
        <span class="text-foreground font-medium">{author}</span>
      </nav>

      <div class="flex flex-col gap-4">
        <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">{author}</h1>

        {books.length > 0 && (
          <div class="mb-4 flex flex-wrap items-center gap-2">
            {sorts.map((s) => (
              <a
                href={`/authors/${encodeURIComponent(author)}?sort=${s.key}&page=1`}
                class={`btn btn-sm min-h-10 ${sortBy === s.key ? "btn-primary" : "btn-ghost"}`}
              >
                {s.label}
              </a>
            ))}
          </div>
        )}

        {books.length === 0 ? (
          NO_BOOKS_FOUND(author)
        ) : (
          <>
            <p class="text-muted-foreground tabular-nums text-sm">
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
                    href={`/authors/${encodeURIComponent(author)}?sort=${sortBy}&page=${currentPage - 1}`}
                    class="btn btn-sm btn-ghost min-w-10 min-h-10"
                  >
                    <span class="sr-only">Previous</span>
                    <ChevronLeft />
                  </a>
                ) : (
                  <span
                    class="btn btn-sm btn-ghost min-w-10 min-h-10 opacity-50"
                    aria-disabled="true"
                  >
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
                      href={`/authors/${encodeURIComponent(author)}?sort=${sortBy}&page=${pageNum}`}
                      class={`btn btn-sm min-w-10 min-h-10 tabular-nums ${isCurrentPage ? "btn-primary" : "btn-ghost"}`}
                      aria-current={isCurrentPage ? "page" : undefined}
                    >
                      {pageNum}
                    </a>
                  );
                })}

                {currentPage < totalPages ? (
                  <a
                    href={`/authors/${encodeURIComponent(author)}?sort=${sortBy}&page=${currentPage + 1}`}
                    class="btn btn-sm btn-ghost min-w-10 min-h-10"
                  >
                    <span class="sr-only">Next</span>
                    <ChevronRight />
                  </a>
                ) : (
                  <span
                    class="btn btn-sm btn-ghost min-w-10 min-h-10 opacity-50"
                    aria-disabled="true"
                  >
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

export async function getBooksByAuthor(
  author: string,
  ctx: AppContext,
  page: number = 1,
  pageSize: number = 100,
  sortBy: SortOption = "popularity",
  c: Context,
): Promise<{
  books: HiveBook[];
  totalBooks: number;
  totalPages: number;
  currentPage: number;
}> {
  const validPage = Math.max(1, page);
  const offset = (validPage - 1) * pageSize;

  // Build the author matching condition for tab-separated authors field
  // Authors are stored as "Author1\tAuthor2\tAuthor3"
  const patterns = buildAuthorLikePatterns(author);
  const authorCondition = sql`(
    authors = ${patterns.exact}
    OR authors LIKE ${patterns.first}
    OR authors LIKE ${patterns.middle}
    OR authors LIKE ${patterns.last}
  )`;

  startTime(c, "author-books-count-query");
  startTime(c, "author-books-data-query");

  let dataQuery = ctx.db
    .selectFrom("hive_book")
    .selectAll()
    .where(authorCondition as any);

  switch (sortBy) {
    case "popularity":
      dataQuery = dataQuery.orderBy("ratingsCount", "desc").orderBy("rating", "desc");
      break;
    case "reviews":
      dataQuery = dataQuery.orderBy("rating", "desc").orderBy("ratingsCount", "desc");
      break;
  }

  const [totalCountResult, books] = await Promise.all([
    ctx.db
      .selectFrom("hive_book")
      .select(sql<number>`COUNT(*)`.as("count"))
      .where(authorCondition as any)
      .executeTakeFirst()
      .then((r) => {
        endTime(c, "author-books-count-query");
        return r;
      }),
    dataQuery
      .limit(pageSize)
      .offset(offset)
      .execute()
      .then((r) => {
        endTime(c, "author-books-data-query");
        return r;
      }),
  ]);

  const totalBooks = totalCountResult?.count || 0;
  const totalPages = Math.ceil(totalBooks / pageSize);

  return {
    books,
    totalBooks,
    totalPages,
    currentPage: validPage,
  };
}
