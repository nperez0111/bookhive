import { type FC } from "hono/jsx";
import { type Book } from "../types";
import type { BookListRow, ProfileViewDetailed } from "../types";
import { BookList } from "./components/book";
import { ProfileHeader } from "./components/ProfileHeader";
import { BookReview } from "./components/BookReview";
import { BOOK_STATUS } from "../constants";
import { UserBlock } from "./components/cards";

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
}) => {
  const year = new Date().getFullYear();
  const booksThisYear = books.filter(
    (b) =>
      b.status === BOOK_STATUS.FINISHED &&
      b.finishedAt &&
      new Date(b.finishedAt).getFullYear() === year,
  ).length;
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
  const pagesRead = books.reduce((sum, b) => {
    const fromProgress = b.bookProgress?.totalPages;
    if (fromProgress != null && fromProgress > 0) return sum + fromProgress;
    if (b.meta) {
      try {
        const m = JSON.parse(b.meta);
        if (m.numPages != null && m.numPages > 0) return sum + m.numPages;
      } catch {}
    }
    return sum;
  }, 0);
  const totalBooksForGenre = genreStats.reduce((s, g) => s + g.count, 0);

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
      />

      {isBuzzer ? (
        <>
          {/* Reading Stats */}
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
                      <div key={g.genre} class="flex items-center gap-2">
                        <span class="text-foreground w-24 truncate text-sm">{g.genre}</span>
                        <div class="bg-muted h-4 flex-1 rounded">
                          <div
                            class="bg-primary h-4 rounded"
                            style={`width: ${(g.count / totalBooksForGenre) * 100}%`}
                          />
                        </div>
                        <span class="text-muted-foreground tabular-nums text-sm">{g.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p class="mt-4">
                <a
                  href={`/profile/${handle}/stats/${year}`}
                  class="text-primary hover:underline text-sm font-medium min-h-[40px] inline-flex items-center"
                >
                  See your Year in Books →
                </a>
              </p>
            </div>
          </div>

          {/* Library */}
          <section>
            <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">Library</h2>
            {isOwnProfile ? (
              <div
                id="mount-library-table"
                data-books={JSON.stringify(
                  books.map((b) => ({
                    hiveId: b.hiveId,
                    title: b.title,
                    authors: b.authors,
                    cover: b.cover,
                    thumbnail: b.thumbnail,
                    status: b.status,
                    stars: b.stars,
                    startedAt: b.startedAt,
                    finishedAt: b.finishedAt,
                    createdAt: b.createdAt,
                    owned: b.owned,
                    review: b.review,
                  })),
                )}
              />
            ) : (
              <BookList books={books} />
            )}
          </section>

          {/* Shelves */}
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

          {/* Reviews */}
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

          {/* Following / Followers tabs */}
          {(followingCount > 0 || followersCount > 0) && (
            <div class="tabs mt-4">
              <input
                type="radio"
                name="social-tabs"
                id="tab-following"
                checked
                class="peer sr-only"
              />
              <label for="tab-following" class="tab-label">
                Following ({followingCount})
              </label>

              <input type="radio" name="social-tabs" id="tab-followers" class="peer sr-only" />
              <label for="tab-followers" class="tab-label">
                Followers ({followersCount})
              </label>

              <div class="tab-content">
                <div class="tab-panel" data-tab="following">
                  <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
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
                <div class="tab-panel" data-tab="followers">
                  <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
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
              </div>
            </div>
          )}
        </>
      ) : (
        <div class="text-muted-foreground text-center">This user has no books on BookHive yet.</div>
      )}
    </div>
  );
};
