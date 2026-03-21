import { type FC } from "hono/jsx";
import type { ProfileViewDetailed } from "../types";
import { BookList } from "./components/book";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import { BookFields } from "../db";
import type { Book } from "../types";
import { LibraryImport } from "./import";
import { BuzzSection } from "./components/buzz";
import { hydrateUserBook } from "../utils/bookProgress";
import { BOOK_STATUS } from "../constants";
import { formatDistanceToNow } from "date-fns";
import { getProfiles } from "../utils/getProfile";
import { StarCount } from "./components/cards";

function LatestActivitySection({
  books,
  didHandleMap,
  profileMap,
  user,
}: {
  books: Book[];
  didHandleMap: Record<string, string>;
  profileMap: Record<string, { avatar?: string | null }>;
  user?: ProfileViewDetailed | null;
}) {
  return (
    <BuzzSection
      title="Recent buzzes"
      subtitle="See what others are reading and what they think about it."
      books={books}
      didHandleMap={didHandleMap}
      profileMap={profileMap}
      viewAllHref="/feed"
      viewAllLabel="View all"
      viewAllAuthRequired
      user={user ? { did: user.did, handle: user.handle } : undefined}
    />
  );
}

function FriendsBuzzesSection({
  books,
  didHandleMap,
  profileMap,
  user,
}: {
  books: Book[];
  didHandleMap: Record<string, string>;
  profileMap: Record<string, { avatar?: string | null }>;
  user?: ProfileViewDetailed | null;
}) {
  return (
    <BuzzSection
      title="Recent buzzes from friends"
      subtitle="See what your followers are reading and what they think about it."
      books={books}
      didHandleMap={didHandleMap}
      profileMap={profileMap}
      viewAllHref="/feed"
      viewAllLabel="View all"
      viewAllAuthRequired
      user={user ? { did: user.did, handle: user.handle } : undefined}
    />
  );
}

function Dashboard({
  profile,
  myBooks,
  friendsBuzzes,
  didHandleMap,
  friendProfiles,
}: {
  profile: ProfileViewDetailed;
  myBooks: Book[];
  friendsBuzzes: Book[];
  didHandleMap: Record<string, string>;
  friendProfiles: ProfileViewDetailed[];
}) {
  const displayName = profile.displayName ?? profile.handle ?? "there";
  const currentlyReading = myBooks.filter((b) => b.status === BOOK_STATUS.READING);
  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  const totalRead = myBooks.filter((b) => b.status === BOOK_STATUS.FINISHED).length;
  const thisMonth = myBooks.filter(
    (b) =>
      b.status === BOOK_STATUS.FINISHED &&
      b.finishedAt &&
      new Date(b.finishedAt).getFullYear() === year &&
      new Date(b.finishedAt).getMonth() === month,
  ).length;
  const thisYear = myBooks.filter(
    (b) =>
      b.status === BOOK_STATUS.FINISHED &&
      b.finishedAt &&
      new Date(b.finishedAt).getFullYear() === year,
  ).length;

  const profileByDid = Object.fromEntries(friendProfiles.map((p) => [p.did, p]));

  return (
    <div class="space-y-6 px-4 pt-6 sm:space-y-8 sm:pt-8 lg:px-8">
      <h2 class="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
        Welcome back, {displayName}
      </h2>

      <div class="grid gap-6 sm:gap-8 lg:grid-cols-3">
        {/* Left column: 1/3 */}
        <div class="space-y-4 sm:space-y-6 lg:col-span-1">
          {currentlyReading.length > 0 && (
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Currently Reading</h2>
              </div>
              <div class="card-body space-y-4">
                {currentlyReading.slice(0, 5).map((book) => {
                  const progress = book.bookProgress?.percent ?? 0;
                  const cur = book.bookProgress?.currentPage;
                  const total = book.bookProgress?.totalPages;
                  return (
                    <div key={book.hiveId} class="flex gap-3">
                      <a href={`/books/${book.hiveId}`} class="shrink-0">
                        {book.cover || book.thumbnail ? (
                          <img
                            src={book.cover || book.thumbnail || ""}
                            alt=""
                            class="h-24 w-16 rounded object-cover"
                          />
                        ) : (
                          <div class="bg-muted h-24 w-16 rounded" />
                        )}
                      </a>
                      <div class="min-w-0 flex-1">
                        <a
                          href={`/books/${book.hiveId}`}
                          class="text-foreground font-semibold hover:underline"
                        >
                          {book.title}
                        </a>
                        <div class="text-muted-foreground text-sm">
                          {book.authors.split("\t").join(", ")}
                        </div>
                        <div class="mt-2">
                          <div class="mb-1 flex justify-between text-sm">
                            <span>{Math.round(progress)}%</span>
                            {cur != null && total != null && (
                              <span class="text-muted-foreground">
                                {cur} / {total}
                              </span>
                            )}
                          </div>
                          <div class="progress">
                            <div class="progress-bar" style={`width: ${progress}%`} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div class="card">
            <div class="card-header">
              <h2 class="card-title">Quick Stats</h2>
            </div>
            <div class="card-body">
              <div class="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div class="text-foreground text-2xl font-bold">{totalRead}</div>
                  <div class="text-muted-foreground text-xs">Total Read</div>
                </div>
                <div>
                  <div class="text-foreground text-2xl font-bold">{thisMonth}</div>
                  <div class="text-muted-foreground text-xs">This Month</div>
                </div>
                <div>
                  <div class="text-foreground text-2xl font-bold">{thisYear}</div>
                  <div class="text-muted-foreground text-xs">This Year</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: 2/3 - Friend Activity */}
        <div class="lg:col-span-2">
          <div class="card">
            <div class="card-header flex items-center justify-between">
              <h2 class="card-title">Friend Activity</h2>
              <a href="/feed" class="text-primary text-sm hover:underline">
                View all
              </a>
            </div>
            <div class="card-body space-y-4">
              {friendsBuzzes.length === 0 ? (
                <p class="text-muted-foreground text-sm">
                  Follow people on BookHive to see their activity here.
                </p>
              ) : (
                friendsBuzzes.slice(0, 10).map((activity) => {
                  const handle = didHandleMap[activity.userDid] ?? activity.userDid;
                  const prof = profileByDid[activity.userDid];
                  const timeAgo = formatDistanceToNow(new Date(activity.createdAt), {
                    addSuffix: true,
                  });
                  return (
                    <div key={`${activity.userDid}-${activity.hiveId}`} class="flex gap-3">
                      <a
                        href={`/profile/${handle}`}
                        class="shrink-0"
                        aria-label={`${handle}'s profile`}
                      >
                        {prof?.avatar ? (
                          <img
                            src={`/images/w_100/${prof.avatar}`}
                            alt=""
                            class="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div class="bg-muted h-8 w-8 rounded-full" />
                        )}
                      </a>
                      <div class="min-w-0 flex-1">
                        <div class="text-sm">
                          <a
                            href={`/profile/${handle}`}
                            class="text-foreground font-semibold hover:underline"
                          >
                            @{handle}
                          </a>
                          <span class="text-muted-foreground"> finished </span>
                          <a
                            href={`/books/${activity.hiveId}`}
                            class="text-foreground font-semibold hover:underline"
                          >
                            {activity.title}
                          </a>
                        </div>
                        {activity.stars != null && activity.stars > 0 && (
                          <div class="mt-1 text-sm">
                            <StarCount count={activity.stars / 2} />
                          </div>
                        )}
                        {activity.review && (
                          <p class="text-muted-foreground mt-1 line-clamp-2 text-sm">
                            {activity.review}
                          </p>
                        )}
                        <div class="text-muted-foreground mt-1 text-xs">{timeAgo}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Your books - link to profile */}
      <div class="card">
        <div class="card-body">
          <h2 class="text-foreground mb-3 text-xl font-bold sm:mb-4">Your library</h2>
          <BookList fallback={<LibraryImport />} />
        </div>
      </div>
    </div>
  );
}

export const Home: FC = async () => {
  const c = useRequestContext();

  startTime(c, "profile");
  const profile = await c.get("ctx").getProfile();
  endTime(c, "profile");

  if (!profile) {
    return <div />;
  }

  startTime(c, "myBooks");
  const myBooksRows = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .where("user_book.userDid", "=", profile.did)
    .orderBy("user_book.indexedAt", "desc")
    .limit(10_000)
    .execute();
  const myBooks = myBooksRows.map((row) => hydrateUserBook(row));
  endTime(c, "myBooks");

  startTime(c, "friendsBuzzes");
  const friendsBuzzes = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .innerJoin("user_follows", "user_book.userDid", "user_follows.followsDid")
    .select(BookFields)
    .where("user_follows.userDid", "=", profile.did)
    .where("user_follows.isActive", "=", 1)
    .orderBy("user_book.createdAt", "desc")
    .limit(50)
    .execute();
  endTime(c, "friendsBuzzes");

  startTime(c, "latestBuzzes");
  const latestBuzzes = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .orderBy("user_book.createdAt", "desc")
    .limit(100)
    .execute();
  endTime(c, "latestBuzzes");

  const friendDids = [...new Set(friendsBuzzes.map((b) => b.userDid))];
  startTime(c, "friendProfiles");
  const friendProfiles =
    friendDids.length > 0 ? await getProfiles({ ctx: c.get("ctx"), dids: friendDids }) : [];
  endTime(c, "friendProfiles");

  const allDids = [
    ...new Set([...latestBuzzes.map((b) => b.userDid), ...friendsBuzzes.map((b) => b.userDid)]),
  ];
  startTime(c, "didHandleMap");
  const [didHandleMap, allProfiles] = await Promise.all([
    c.get("ctx").resolver.resolveDidsToHandles(allDids),
    getProfiles({ ctx: c.get("ctx"), dids: allDids }),
  ]);
  endTime(c, "didHandleMap");
  const profileMap = Object.fromEntries(allProfiles.map((p) => [p.did, { avatar: p.avatar }]));

  return (
    <div class="space-y-8 sm:space-y-10">
      <Dashboard
        profile={profile}
        myBooks={myBooks}
        friendsBuzzes={friendsBuzzes as Book[]}
        didHandleMap={didHandleMap}
        friendProfiles={friendProfiles}
      />
      {friendsBuzzes.length > 0 ? (
        <FriendsBuzzesSection
          books={friendsBuzzes as Book[]}
          didHandleMap={didHandleMap}
          profileMap={profileMap}
          user={profile}
        />
      ) : null}
      <LatestActivitySection
        books={latestBuzzes as Book[]}
        didHandleMap={didHandleMap}
        profileMap={profileMap}
        user={profile}
      />
    </div>
  );
};
