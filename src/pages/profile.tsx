import { type FC } from "hono/jsx";
import { type Book } from "../types";
import type { BookListRow, ProfileViewDetailed } from "../types";
import { BookList } from "./components/book";
import { ProfileHeader } from "./components/ProfileHeader";
import { BookReview } from "./components/BookReview";
import { BOOK_STATUS } from "../constants";
import { booksFinishedInYear } from "../core/readingYear";
import { UserBlock } from "./components/cards";
import { coverImageUrl } from "../core/imageUrl";
import { TrackedBooks } from "./components/TrackedBooks";
import { computeReadingStats } from "../data/readingStats";
import { ProgressMeter } from "./components/ProgressMeter";
import { TimeAgo } from "./components/TimeAgo";

export const ProfilePage: FC<{
  handle: string;
  did: string;
  books: Book[];
  isBuzzer: boolean;
  profile: ProfileViewDetailed | null;
  isFollowing?: boolean;
  canFollow?: boolean;
  isOwnProfile?: boolean;
  followingCount?: number;
  followersCount?: number;
  followingProfiles?: ProfileViewDetailed[];
  followersProfiles?: ProfileViewDetailed[];
  genreStats?: { genre: string; count: number }[];
  userLists?: Array<BookListRow & { itemCount: number | null }>;
  progressHistory?: {
    hiveId: string;
    title: string;
    cover: string | null;
    thumbnail: string;
    currentPage: number | null;
    totalPages: number | null;
    percent: number | null;
    createdAt: string;
  }[];
}> = ({
  handle,
  did,
  profile,
  books,
  isBuzzer,
  isFollowing,
  canFollow,
  isOwnProfile,
  followingCount = 0,
  followersCount = 0,
  followingProfiles = [],
  followersProfiles = [],
  genreStats = [],
  userLists = [],
  progressHistory = [],
}) => {
  const year = new Date().getUTCFullYear();
  const booksThisYear = booksFinishedInYear(books, year);
  const finishedWithRating = books.filter(
    (b) => b.status === BOOK_STATUS.FINISHED && b.stars != null,
  );
  const avgRating =
    finishedWithRating.length > 0
      ? (
          finishedWithRating.reduce((s, b) => s + (b.stars ?? 0), 0) /
          finishedWithRating.length /
          2
        ).toFixed(1)
      : "—";
  const totalRead = books.filter((b) => b.status === BOOK_STATUS.FINISHED).length;
  const monthsActive = 12; // could derive from first book date
  const booksPerMonth = totalRead > 0 ? (totalRead / monthsActive).toFixed(1) : "0";
  // Use the same finished-book scope and page-count precedence as detailed reading stats.
  const { pagesRead } = computeReadingStats(books, []);
  const totalBooksForGenre = genreStats.reduce((s, g) => s + g.count, 0);
  // Scaled against the top genre, not the sum — a book carries several genres, so the sum dwarfs any one count.
  const maxGenreCount = genreStats.reduce((m, g) => Math.max(m, g.count), 0);

  return (
    <div class="space-y-6 px-4 lg:px-8">
      <ProfileHeader
        handle={handle}
        did={did}
        isFollowing={isFollowing}
        canFollow={canFollow}
        isOwnProfile={isOwnProfile}
        profile={profile}
        books={books}
        followingCount={followingCount}
        followersCount={followersCount}
      />

      {isBuzzer ? (
        <>
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">Reading Stats</h2>
            </div>
            <div class="card-body">
              <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div class="text-center">
                  <div class="text-3xl font-bold text-foreground tabular-nums">{booksThisYear}</div>
                  <div class="text-muted-foreground text-sm">Books in {year}</div>
                </div>
                <div class="text-center">
                  <div class="text-3xl font-bold text-foreground tabular-nums">{avgRating}</div>
                  <div class="text-muted-foreground text-sm">Avg Rating</div>
                </div>
                <div class="text-center">
                  <div class="text-3xl font-bold text-foreground tabular-nums">{booksPerMonth}</div>
                  <div class="text-muted-foreground text-sm">Books/Month</div>
                </div>
                <div class="text-center">
                  <div class="text-3xl font-bold text-foreground tabular-nums">
                    {pagesRead > 0 ? pagesRead.toLocaleString() : "—"}
                  </div>
                  <div class="text-muted-foreground text-sm">Pages Read</div>
                </div>
              </div>

              {genreStats.length > 0 && totalBooksForGenre > 0 && (
                <div class="mt-6">
                  <h3 class="text-muted-foreground mb-2 text-sm font-semibold">
                    Genre Distribution
                  </h3>
                  <div class="space-y-1">
                    {genreStats.map((g) => (
                      <div key={g.genre} class="flex items-center gap-3">
                        <a
                          href={`/explore/genres/${encodeURIComponent(g.genre)}`}
                          class="text-foreground hover:text-primary w-36 shrink-0 truncate text-sm transition-[color] duration-150"
                          title={g.genre}
                        >
                          {g.genre}
                        </a>
                        <ProgressMeter
                          percent={(g.count / maxGenreCount) * 100}
                          minWidth={2}
                          barClass="bg-primary"
                          class="min-w-0 flex-1"
                        />
                        <span class="text-muted-foreground w-8 shrink-0 text-right tabular-nums text-sm">
                          {g.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p class="mt-4">
                <a
                  href={`/profile/${handle}/stats/${year}`}
                  class="text-primary hover:underline text-sm font-medium min-h-10 inline-flex items-center"
                >
                  See your Year in Books →
                </a>
              </p>
            </div>
          </div>

          {isOwnProfile && progressHistory.length > 0 && (
            <section>
              <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">
                Recent Reading Activity
              </h2>
              <div class="card">
                <div class="card-body">
                  <ol class="divide-border divide-y">
                    {progressHistory.map((entry, i) => (
                      <li key={`${entry.hiveId}-${i}`} class="flex items-center gap-3 py-2.5">
                        {/* Redundant with the title link below — hidden from AT and tab order. */}
                        <a
                          href={`/books/${entry.hiveId}`}
                          class="book-cover-frame shrink-0 overflow-hidden rounded"
                          aria-hidden="true"
                          tabindex={-1}
                        >
                          <img
                            src={coverImageUrl(entry.hiveId, { width: 64 })}
                            alt=""
                            loading="lazy"
                            width="32"
                            height="48"
                            class="book-cover h-12 w-8 rounded object-cover"
                          />
                        </a>
                        <div class="min-w-0 flex-1">
                          <p class="text-sm leading-snug">
                            <span class="tabular-nums text-foreground font-medium">
                              Page {entry.currentPage}
                              {entry.totalPages ? ` of ${entry.totalPages}` : ""}
                            </span>
                            {entry.percent != null && (
                              <span class="text-muted-foreground ml-1">({entry.percent}%)</span>
                            )}
                            <span class="text-muted-foreground"> &mdash; </span>
                            <a
                              href={`/books/${entry.hiveId}`}
                              class="text-foreground hover:text-primary font-semibold"
                            >
                              {entry.title}
                            </a>
                          </p>
                          <TimeAgo ts={entry.createdAt} class="mt-0.5 block" />
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </section>
          )}

          <section>
            <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">Library</h2>
            {isOwnProfile ? <TrackedBooks books={books} /> : <BookList books={books} />}
          </section>

          {userLists.length > 0 && (
            <section>
              <div class="mb-4 flex items-center justify-between">
                <h2 class="text-2xl font-bold tracking-tight text-foreground">Shelves</h2>
                <a
                  href={`/shelves/${handle}`}
                  class="text-sm font-medium text-primary hover:underline"
                >
                  View all →
                </a>
              </div>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {userLists.slice(0, 6).map((list) => {
                  const rkey = list.uri.split("/").at(-1)!;
                  return (
                    <a
                      key={list.uri}
                      href={`/shelves/${handle}/${rkey}`}
                      class="card group flex flex-col gap-1 p-4 transition-[box-shadow,color] duration-150 ease-out hover:shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]"
                    >
                      <h3 class="font-semibold text-foreground group-hover:text-primary line-clamp-1">
                        {list.name}
                      </h3>
                      {list.description && (
                        <p class="text-sm text-muted-foreground line-clamp-1">{list.description}</p>
                      )}
                      <p class="mt-auto text-xs text-muted-foreground">
                        <span class="tabular-nums">{list.itemCount ?? 0}</span>{" "}
                        {(list.itemCount ?? 0) === 1 ? "book" : "books"}
                      </p>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {books.some((book) => book.review) && (
            <section>
              <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">Reviews</h2>
              <div class="space-y-4">
                {books
                  .filter((book) => book.review)
                  .map((book) => (
                    <BookReview key={book.hiveId} book={book} />
                  ))}
              </div>
            </section>
          )}

          {/* Social — Following & Followers */}
          {(followingCount > 0 || followersCount > 0) && (
            <section id="social" class="scroll-mt-6 space-y-6">
              {followingCount > 0 && (
                <div>
                  <h3 class="text-foreground mb-3 text-sm font-semibold">
                    Following
                    <span class="text-muted-foreground ml-1 tabular-nums font-normal">
                      {followingCount}
                    </span>
                  </h3>
                  <div class="flex flex-wrap gap-2">
                    {followingProfiles.map((user) => (
                      <a
                        key={user.did}
                        href={`/profile/${user.handle ?? user.did}`}
                        class="card flex items-center gap-2 p-2 transition-[box-shadow] duration-150 ease-out hover:shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]"
                      >
                        <UserBlock
                          handle={user.handle ?? user.did}
                          avatar={user.avatar ?? null}
                          displayName={null}
                          size="sm"
                          noLink
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {followersCount > 0 && (
                <div>
                  <h3 class="text-foreground mb-3 text-sm font-semibold">
                    Followers
                    <span class="text-muted-foreground ml-1 tabular-nums font-normal">
                      {followersCount}
                    </span>
                  </h3>
                  <div class="flex flex-wrap gap-2">
                    {followersProfiles.map((user) => (
                      <a
                        key={user.did}
                        href={`/profile/${user.handle ?? user.did}`}
                        class="card flex items-center gap-2 p-2 transition-[box-shadow] duration-150 ease-out hover:shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]"
                      >
                        <UserBlock
                          handle={user.handle ?? user.did}
                          avatar={user.avatar ?? null}
                          displayName={null}
                          size="sm"
                          noLink
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <div class="card">
          <div class="card-body">
            <div class="empty">
              <h2 class="empty-title">
                {/* "Shelves" means user-created lists elsewhere in the app; this empty state is about having no books at all. */}
                {isOwnProfile ? "Your library is empty" : "No books yet"}
              </h2>
              <p class="empty-description">
                {isOwnProfile
                  ? "Search for a book to add your first read, or bring your history over from Goodreads or StoryGraph or Hardcover."
                  : `@${handle} hasn't added any books to BookHive yet.`}
              </p>
              {isOwnProfile && (
                <div class="mt-4 flex flex-wrap justify-center gap-2">
                  <a href="/explore" class="btn btn-primary min-h-10">
                    Find a book
                  </a>
                  <a href="/import" class="btn btn-outline min-h-10">
                    Import your library
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
