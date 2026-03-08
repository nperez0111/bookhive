import { type FC, Fragment } from "hono/jsx";
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

function Hero() {
  return (
    <main class="relative px-4 pt-12 pb-10 sm:pt-14 sm:pb-12 md:pt-12 md:pb-24 lg:px-8">
      <div class="card mx-auto max-w-5xl">
        <div class="card-body flex flex-col items-center gap-8 md:flex-row md:items-center md:gap-12">
          <div class="flex justify-center md:order-2">
            <img
              src="/hive.jpg"
              alt="Bee sitting on a stack of books"
              class="max-h-[280px] w-[70%] max-w-[520px] rounded-xl object-cover sm:w-auto"
            />
          </div>
          <div class="text-center md:order-1 md:text-left">
            <h1 class="text-foreground text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
              The social platform for <span class="text-primary">book lovers</span>
            </h1>
            <p class="text-muted-foreground mt-4 max-w-xl text-lg">
              Follow your friends, discover new books, and own your data on the AT protocol.
            </p>
            <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center md:justify-start">
              <a href="/login" class="btn btn-primary">
                Get started
              </a>
              <a href="/genres" class="btn btn-ghost">
                Explore genres
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Features() {
  const features = [
    {
      title: "Manage your books",
      description: "Add books to your library, mark them as read, reading, or want to read.",
      icon: (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      ),
    },
    {
      title: "Follow your friends",
      description: "See what your friends are reading and what they thought about it.",
      icon: (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      ),
    },
    {
      title: "Discover new books",
      description: "Find books and authors based on what you and your friends read.",
      icon: (
        <>
          <path d="M10 10h4" />
          <path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3" />
          <path d="M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z" />
          <path d="M 22 16 L 2 16" />
          <path d="M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z" />
          <path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3" />
        </>
      ),
    },
    {
      title: "Rate and review",
      description: "Rate books out of 5 stars and leave reviews to share with friends.",
      icon: (
        <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
      ),
    },
    {
      title: "Own your data",
      description: "Built on the AT protocol — your library and reviews live in your account.",
      icon: (
        <>
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          <path d="M12 10v6" />
          <path d="m15 13-3 3-3-3" />
        </>
      ),
    },
  ];

  return (
    <div class="px-4 lg:px-8">
      <div class="mt-10 text-center sm:mt-12 md:mt-16">
        <h2 class="text-foreground text-3xl font-bold tracking-tight lg:text-4xl">
          Everything you need to{" "}
          <span class="text-primary decoration-primary underline decoration-2 underline-offset-4">
            manage your books
          </span>
        </h2>
        <p class="text-muted-foreground mt-4 text-lg">BookHive keeps your library in one place.</p>
      </div>

      <div class="mt-8 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-6 md:grid-cols-3">
        {features.map((item) => (
          <div key={item.title} class="card">
            <div class="card-body flex gap-4">
              <div class="bg-primary/10 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  {item.icon}
                </svg>
              </div>
              <div>
                <h3 class="text-foreground font-semibold">{item.title}</h3>
                <p class="text-muted-foreground mt-1 text-sm leading-relaxed">{item.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LatestActivitySection({
  books,
  didHandleMap,
  user,
}: {
  books: Book[];
  didHandleMap: Record<string, string>;
  user?: ProfileViewDetailed | null;
}) {
  return (
    <BuzzSection
      title="Recent buzzes"
      subtitle="See what others are reading and what they think about it."
      books={books}
      didHandleMap={didHandleMap}
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
  user,
}: {
  books: Book[];
  didHandleMap: Record<string, string>;
  user?: ProfileViewDetailed | null;
}) {
  return (
    <BuzzSection
      title="Recent buzzes from friends"
      subtitle="See what your followers are reading and what they think about it."
      books={books}
      didHandleMap={didHandleMap}
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

  let friendsBuzzes: Awaited<typeof latestBuzzes> = [];
  let myBooks: Book[] = [];
  let friendProfiles: ProfileViewDetailed[] = [];

  if (profile) {
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
    myBooks = myBooksRows.map((row) => hydrateUserBook(row));
    endTime(c, "myBooks");

    startTime(c, "friendsBuzzes");
    friendsBuzzes = await c
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

    const friendDids = [...new Set(friendsBuzzes.map((b) => b.userDid))];
    if (friendDids.length > 0) {
      friendProfiles = await getProfiles({
        ctx: c.get("ctx"),
        dids: friendDids,
      });
    }
  }

  const allDids = [
    ...new Set([...latestBuzzes.map((b) => b.userDid), ...friendsBuzzes.map((b) => b.userDid)]),
  ];
  startTime(c, "didHandleMap");
  const didHandleMap = await c.get("ctx").resolver.resolveDidsToHandles(allDids);
  endTime(c, "didHandleMap");

  return (
    <div class="space-y-8 sm:space-y-10">
      {profile ? (
        <Dashboard
          profile={profile}
          myBooks={myBooks}
          friendsBuzzes={friendsBuzzes as Book[]}
          didHandleMap={didHandleMap}
          friendProfiles={friendProfiles}
        />
      ) : (
        <Fragment>
          <Hero />
          <Features />
        </Fragment>
      )}
      {friendsBuzzes.length > 0 ? (
        <FriendsBuzzesSection
          books={friendsBuzzes as Book[]}
          didHandleMap={didHandleMap}
          user={profile}
        />
      ) : null}
      <LatestActivitySection
        books={latestBuzzes as Book[]}
        didHandleMap={didHandleMap}
        user={profile}
      />
    </div>
  );
};
