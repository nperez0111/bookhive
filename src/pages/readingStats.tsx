import { type FC } from "hono/jsx";
import type { Book } from "../types";
import type { ProfileViewDetailed } from "../types";
import type { ReadingStats } from "../utils/readingStats";
import { ProfileHeader } from "./components/ProfileHeader";
import { FallbackCover } from "./components/fallbackCover";
import { format } from "date-fns";

export const ReadingStatsPage: FC<{
  handle: string;
  did: string;
  year: number | null;
  stats: ReadingStats;
  profile: ProfileViewDetailed | null;
  isOwnProfile: boolean;
  availableYears: number[];
  books: Book[];
  allTimeStats?: ReadingStats;
  showYearInBooks: boolean;
}> = ({
  handle,
  did,
  year,
  stats,
  profile,
  isOwnProfile,
  availableYears,
  books,
  allTimeStats,
  showYearInBooks,
}) => {
  const title = year != null ? `Your ${year} in Books` : "Your reading stats";
  const totalBooksForGenre = stats.topGenres.reduce((s, g) => s + g.count, 0);
  const maxRatingCount = Math.max(1, ...Object.values(stats.ratingDistribution));

  return (
    <div class="space-y-6 px-4 lg:px-8">
      <ProfileHeader
        handle={handle}
        did={did}
        isFollowing={undefined}
        canFollow={!isOwnProfile}
        isOwnProfile={isOwnProfile}
        profile={profile}
        books={books}
      />

      {/* Year selector */}
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-bold text-foreground">{title}</h1>
        {availableYears.length > 0 && (
          <nav class="flex flex-wrap gap-1" aria-label="Choose year">
            {year != null && (
              <a
                href={`/profile/${handle}/stats`}
                class={
                  "rounded px-2 py-1 text-sm " +
                  (year === new Date().getFullYear()
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted")
                }
              >
                This year
              </a>
            )}
            {availableYears
              .filter((y) => y !== new Date().getFullYear())
              .map((y) => (
                <a
                  key={y}
                  href={`/profile/${handle}/stats/${y}`}
                  class={
                    "rounded px-2 py-1 text-sm " +
                    (y === year
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted")
                  }
                >
                  {y}
                </a>
              ))}
          </nav>
        )}
      </div>

      {!showYearInBooks && year != null && (
        <div class="card bg-muted">
          <div class="card-body">
            <p class="text-foreground">
              Finish at least 3 books in {year} to see your Year in Books.
            </p>
            {allTimeStats && allTimeStats.booksCount > 0 && (
              <p class="text-muted-foreground mt-1 text-sm">
                You have {allTimeStats.booksCount} books read all-time.
              </p>
            )}
          </div>
        </div>
      )}

      {showYearInBooks && (
        <>
          {/* Hero stats - Spotify Wrapped style */}
          <div class="card overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
            <div class="card-body">
              <div class="mb-6 flex flex-wrap items-baseline gap-2">
                <span class="text-4xl font-bold text-foreground md:text-5xl">{year}</span>
                <span class="text-muted-foreground text-xl">Year in Books</span>
              </div>
              <div class="grid grid-cols-2 gap-6 md:grid-cols-4">
                <div class="text-center">
                  <div class="text-4xl font-bold text-foreground md:text-5xl">
                    {stats.booksCount}
                  </div>
                  <div class="text-muted-foreground text-sm">
                    {year != null ? `Books in ${year}` : "Books read"}
                  </div>
                </div>
                <div class="text-center">
                  <div class="text-4xl font-bold text-foreground md:text-5xl">
                    {stats.pagesRead > 0 ? stats.pagesRead.toLocaleString() : "—"}
                  </div>
                  <div class="text-muted-foreground text-sm">Pages read</div>
                </div>
                <div class="text-center">
                  <div class="text-4xl font-bold text-foreground md:text-5xl">
                    {stats.averageRating != null ? stats.averageRating.toFixed(1) : "—"}
                  </div>
                  <div class="text-muted-foreground text-sm">Avg rating</div>
                </div>
                <div class="text-center">
                  <div class="text-4xl font-bold text-foreground md:text-5xl">
                    {stats.averagePageCount != null ? stats.averagePageCount.toLocaleString() : "—"}
                  </div>
                  <div class="text-muted-foreground text-sm">Avg length (pgs)</div>
                </div>
              </div>
            </div>
          </div>

          {/* First & Last book of year */}
          {(stats.firstBookOfYear || stats.lastBookOfYear) && (
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Bookends of the year</h2>
              </div>
              <div class="card-body grid gap-6 md:grid-cols-2">
                {stats.firstBookOfYear && (
                  <div>
                    <p class="text-muted-foreground mb-1 text-sm">
                      First book finished
                      {stats.firstBookOfYear.finishedAt && (
                        <span class="ml-1">
                          ({format(new Date(stats.firstBookOfYear.finishedAt), "MMM d, yyyy")})
                        </span>
                      )}
                    </p>
                    <BookHighlight book={stats.firstBookOfYear} />
                  </div>
                )}
                {stats.lastBookOfYear && stats.lastBookOfYear !== stats.firstBookOfYear && (
                  <div>
                    <p class="text-muted-foreground mb-1 text-sm">
                      Last book finished
                      {stats.lastBookOfYear.finishedAt && (
                        <span class="ml-1">
                          ({format(new Date(stats.lastBookOfYear.finishedAt), "MMM d, yyyy")})
                        </span>
                      )}
                    </p>
                    <BookHighlight book={stats.lastBookOfYear} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Rating distribution */}
          {(stats.ratingDistribution[1] ||
            stats.ratingDistribution[2] ||
            stats.ratingDistribution[3] ||
            stats.ratingDistribution[4] ||
            stats.ratingDistribution[5]) > 0 && (
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Rating distribution</h2>
              </div>
              <div class="card-body">
                <div class="space-y-2">
                  {([1, 2, 3, 4, 5] as const).map((star) => (
                    <div key={star} class="flex items-center gap-2">
                      <span class="text-muted-foreground w-12 text-sm">
                        {star} star{star !== 1 ? "s" : ""}
                      </span>
                      <div class="bg-muted h-5 flex-1 rounded">
                        <div
                          class="bg-primary h-5 rounded"
                          style={`width: ${(stats.ratingDistribution[star] / maxRatingCount) * 100}%`}
                        />
                      </div>
                      <span class="text-muted-foreground w-8 text-sm">
                        {stats.ratingDistribution[star]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Top genres */}
          {stats.topGenres.length > 0 && totalBooksForGenre > 0 && (
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Top genres</h2>
              </div>
              <div class="card-body">
                <div class="space-y-1">
                  {stats.topGenres.map((g) => (
                    <div key={g.genre} class="flex items-center gap-2">
                      <span class="text-foreground w-24 truncate text-sm">{g.genre}</span>
                      <div class="bg-muted h-4 flex-1 rounded">
                        <div
                          class="bg-primary h-4 rounded"
                          style={`width: ${(g.count / totalBooksForGenre) * 100}%`}
                        />
                      </div>
                      <span class="text-muted-foreground text-sm">{g.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Shortest / longest / most & least popular */}
          <div class="grid gap-4 md:grid-cols-2">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Book length</h2>
              </div>
              <div class="card-body space-y-4">
                {stats.shortestBook && (
                  <div>
                    <p class="text-muted-foreground text-sm">Shortest read</p>
                    <BookHighlight book={stats.shortestBook} />
                  </div>
                )}
                {stats.longestBook && stats.longestBook !== stats.shortestBook && (
                  <div>
                    <p class="text-muted-foreground text-sm">Longest read</p>
                    <BookHighlight book={stats.longestBook} />
                  </div>
                )}
                {!stats.shortestBook && !stats.longestBook && (
                  <p class="text-muted-foreground text-sm">
                    Add page counts to your books to see shortest and longest.
                  </p>
                )}
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Popularity</h2>
              </div>
              <div class="card-body space-y-4">
                {stats.mostPopularBook && (
                  <div>
                    <p class="text-muted-foreground text-sm">Most popular (by community rating)</p>
                    <BookHighlight book={stats.mostPopularBook} />
                  </div>
                )}
                {stats.leastPopularBook && stats.leastPopularBook !== stats.mostPopularBook && (
                  <div>
                    <p class="text-muted-foreground text-sm">Least popular (by community rating)</p>
                    <BookHighlight book={stats.leastPopularBook} />
                  </div>
                )}
                {!stats.mostPopularBook && !stats.leastPopularBook && (
                  <p class="text-muted-foreground text-sm">
                    Community ratings will appear as books are rated.
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

function BookHighlight({ book }: { book: Book }) {
  const pages = book.bookProgress?.totalPages;
  return (
    <a
      href={`/books/${book.hiveId}`}
      class="flex gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
    >
      {book.cover || book.thumbnail ? (
        <img
          src={book.cover ?? book.thumbnail ?? ""}
          alt=""
          class="h-16 w-11 shrink-0 rounded object-cover"
        />
      ) : (
        <FallbackCover className="h-16 w-11 shrink-0" />
      )}
      <div class="min-w-0 flex-1">
        <p class="font-medium text-foreground line-clamp-2">{book.title}</p>
        <p class="text-muted-foreground truncate text-sm">{book.authors}</p>
        {pages != null && <p class="text-muted-foreground text-xs">{pages} pages</p>}
      </div>
    </a>
  );
}
