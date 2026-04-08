import type { FC } from "hono/jsx";
import { formatDistanceToNow } from "date-fns";
import type { ProfileViewDetailed } from "../types";

type RecentActivityItem = {
  userDid: string;
  hiveId: string;
  title: string;
  authors: string;
  status: string | null;
  stars: number | null;
  review: string | null;
  createdAt: string;
  cover: string | null;
  thumbnail: string | null;
};

function getActionText(status: string | null): string {
  if (!status) return "updated";
  if (status.includes("finished")) return "finished reading";
  if (status.includes("reading")) return "started reading";
  if (status.includes("abandoned")) return "abandoned";
  if (status.includes("wantToRead")) return "wants to read";
  return "updated";
}

function MarketingNav({ signupUrl }: { signupUrl: string }) {
  return (
    <nav class="border-border bg-background/90 sticky top-0 z-50 border-b backdrop-blur-sm">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
        <a href="/" class="flex items-center gap-2">
          <img src="/book.svg" alt="" width="28" height="28" />
          <span class="text-foreground text-lg font-bold">BookHive</span>
        </a>
        <div class="flex items-center gap-2">
          <a href="/login" class="btn btn-ghost min-h-[40px] min-w-[40px] text-sm">
            Sign in
          </a>
          <a href={signupUrl} class="btn btn-ghost min-h-[40px] min-w-[40px] text-sm">
            Create account
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero({ signupUrl }: { signupUrl: string }) {
  return (
    <section class="px-4 py-20 sm:py-28 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-col items-center gap-12 md:flex-row md:items-start">
          <div class="flex-1 text-center md:text-left">
            <div class="bg-primary text-primary-foreground mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              The open alternative to Goodreads
            </div>
            <h1 class="text-foreground text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Reading is <span class="text-primary">better together</span>
            </h1>
            <p class="text-muted-foreground mt-6 max-w-xl text-xl">
              Track your books, see what your friends are reading, and discover your next favorite.{" "}
              <br />
              BookHive, an <span class="font-bold">open</span> platform where your data belongs to
              you.
            </p>
            <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center md:justify-start">
              <a href="/login" class="btn btn-primary">
                Sign in with Bluesky
              </a>
              <a href={signupUrl} class="btn btn-ghost">
                Create a free account
              </a>
            </div>
          </div>
          <div class="w-full shrink-0 md:w-[45%]">
            <img
              src="/hive.jpg"
              alt="Bee sitting on a stack of books"
              decoding="async"
              class="w-full rounded-2xl object-cover shadow-xl outline outline-1 outline-black/5 dark:outline-white/10"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function RecentActivityCard({
  activities,
  didHandleMap,
  profileByDid,
}: {
  activities: RecentActivityItem[];
  didHandleMap: Record<string, string>;
  profileByDid: Record<string, ProfileViewDetailed>;
}) {
  if (activities.length === 0) {
    return (
      <div class="card space-y-4 shadow-lg">
        <div class="card-header">
          <p class="text-muted-foreground text-sm font-medium">Recent Activity</p>
        </div>
        <div class="card-body">
          <p class="text-muted-foreground text-sm">No recent activity yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div class="card shadow-lg">
      <div class="card-header">
        <p class="text-muted-foreground text-sm font-medium">Recent Activity</p>
      </div>
      <div class="card-body max-h-[28rem] space-y-4 overflow-y-auto">
        {activities.map((activity, i) => {
          const handle = didHandleMap[activity.userDid] ?? activity.userDid;
          const prof = profileByDid[activity.userDid];
          const timeAgo = formatDistanceToNow(new Date(activity.createdAt), {
            addSuffix: true,
          });
          const actionText = getActionText(activity.status);
          const starDisplay = activity.stars != null ? activity.stars / 2 : 0;

          return (
            <>
              {i > 0 && <div class="h-px bg-border/60" />}
              <div class="flex gap-3" key={`${activity.userDid}-${activity.hiveId}`}>
                <a href={`/profile/${handle}`} class="shrink-0">
                  {prof?.avatar ? (
                    <img
                      src={prof.avatar}
                      alt=""
                      loading="lazy"
                      class="h-9 w-9 rounded-full object-cover outline outline-1 outline-black/5 dark:outline-white/10"
                    />
                  ) : (
                    <div class="bg-primary/20 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold">
                      {handle[0]?.toUpperCase() ?? "?"}
                    </div>
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
                    <span class="text-muted-foreground"> {actionText} </span>
                    <a
                      href={`/books/${activity.hiveId}`}
                      class="text-foreground font-semibold hover:underline"
                    >
                      {activity.title}
                    </a>
                  </div>
                  {starDisplay > 0 && (
                    <div class="mt-1 flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <svg
                          key={s}
                          xmlns="http://www.w3.org/2000/svg"
                          class={`h-4 w-4 ${s <= starDisplay ? "text-primary" : "text-muted"}`}
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
                        </svg>
                      ))}
                    </div>
                  )}
                  {activity.review && (
                    <p class="text-muted-foreground mt-1 line-clamp-2 text-sm">
                      "{activity.review}"
                    </p>
                  )}
                  <div class="text-muted-foreground mt-1 text-xs">{timeAgo}</div>
                </div>
              </div>
            </>
          );
        })}
      </div>
    </div>
  );
}

function SocialSection({
  activities,
  didHandleMap,
  profileByDid,
}: {
  activities: RecentActivityItem[];
  didHandleMap: Record<string, string>;
  profileByDid: Record<string, ProfileViewDetailed>;
}) {
  return (
    <section class="bg-card px-4 py-20 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-col items-center gap-12 lg:flex-row lg:items-start">
          <div class="flex-1">
            <p class="text-primary mb-3 text-sm font-semibold uppercase tracking-widest">
              Community
            </p>
            <h2 class="text-foreground text-4xl font-bold tracking-tight lg:text-5xl">
              Reading may be solitary.
              <br />
              <span class="text-primary">But, it doesn't have to be.</span>
            </h2>
            <p class="text-muted-foreground mt-5 max-w-lg text-lg">
              BookHive connects you with readers who share your taste. See what friends are reading
              right now, follow people with similar interests, and build a community around the
              books you love.
            </p>
            <ul class="mt-8 space-y-4">
              {[
                "See who is reading the same book as you, right now",
                "Follow friends and discover what they recommend",
                "A social feed built around books, not engagement bait",
              ].map((item) => (
                <li key={item} class="flex items-start gap-3">
                  <div class="bg-primary/10 text-primary mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </div>
                  <span class="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div class="w-full lg:w-[45%]">
            <RecentActivityCard
              activities={activities}
              didHandleMap={didHandleMap}
              profileByDid={profileByDid}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function LibrarySection() {
  const features = [
    {
      title: "Custom shelves",
      description:
        "Create shelves for any category — all-time favourites, most informational, guilty pleasures, or anything else.",
      icon: (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      ),
    },
    {
      title: "Track your progress",
      description: "Log your current page, set reading goals, and see your progress at a glance.",
      icon: (
        <>
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
        </>
      ),
    },
    {
      title: "Ratings & reviews",
      description:
        "Rate books out of 5 stars and write reviews to share with the people who follow you.",
      icon: (
        <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
      ),
    },
    {
      title: "Public profile",
      description:
        "Show off your reading life. Share your profile so friends can see what you'd recommend them.",
      icon: (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      ),
    },
  ];

  return (
    <section class="px-4 py-20 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="text-center">
          <p class="text-primary mb-3 text-sm font-semibold uppercase tracking-widest">
            Your Library
          </p>
          <h2 class="text-foreground text-4xl font-bold tracking-tight lg:text-5xl">
            Your complete reading life, <span class="text-primary">organised</span>
          </h2>
          <p class="text-muted-foreground mx-auto mt-5 max-w-2xl text-lg">
            Everything you need to manage your books in one place. From want-to-read to finished,
            with custom shelves for every mood and genre.
          </p>
        </div>
        <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((item) => (
            <div key={item.title} class="card">
              <div class="card-body space-y-3">
                <div class="bg-primary/10 text-primary flex h-11 w-11 items-center justify-center rounded-lg">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5"
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
                <h3 class="text-foreground font-semibold">{item.title}</h3>
                <p class="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type TrendingBook = {
  id: string;
  title: string;
  authors: string;
  thumbnail: string | null;
  readerCount: number;
};

function DiscoverSection({ trendingBooks }: { trendingBooks: TrendingBook[] }) {
  return (
    <section class="bg-card px-4 py-20 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-col items-center gap-12 lg:flex-row-reverse lg:items-center">
          <div class="flex-1">
            <p class="text-primary mb-3 text-sm font-semibold uppercase tracking-widest">
              Discovery
            </p>
            <h2 class="text-foreground text-4xl font-bold tracking-tight lg:text-5xl">
              The best recommendations come from <span class="text-primary">people you trust</span>
            </h2>
            <p class="text-muted-foreground mt-5 max-w-lg text-lg">
              Bumble onto books you'll love. No algorithms, just real people sharing what's on their
              shelves.
            </p>
            <ul class="mt-8 space-y-4">
              {[
                "See what your network is reading and what they think of it",
                "Browse books by genre and author to find your next read",
                "Discover hidden gems through community buzz",
              ].map((item) => (
                <li key={item} class="flex items-start gap-3">
                  <div class="bg-primary/10 text-primary mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </div>
                  <span class="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
            <div class="mt-8">
              <a href="/genres" class="btn btn-ghost">
                Browse genres
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="ml-1.5 h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>
          <div class="bg-background w-full rounded-2xl p-6 shadow-inner lg:w-[40%]">
            <p class="text-muted-foreground mb-4 text-sm font-medium">Trending this week</p>
            <div class="max-h-80 space-y-3 overflow-y-auto pr-2">
              {trendingBooks.map((book, i) => (
                <a
                  key={book.id}
                  href={`/books/${book.id}`}
                  class="flex min-h-[40px] items-center gap-3 rounded-xl transition-colors hover:bg-muted/50 p-2 -m-2"
                >
                  <span class="text-muted-foreground w-5 text-center text-sm font-bold tabular-nums">
                    {i + 1}
                  </span>
                  {book.thumbnail ? (
                    <img
                      src={book.thumbnail}
                      alt=""
                      class="h-12 w-8 shrink-0 rounded object-cover outline outline-1 outline-black/5 dark:outline-white/10"
                      loading="lazy"
                    />
                  ) : (
                    <div class="bg-muted h-12 w-8 shrink-0 rounded" />
                  )}
                  <div class="flex-1">
                    <div class="text-foreground text-sm font-semibold">{book.title}</div>
                    <div class="text-muted-foreground text-xs">{book.authors}</div>
                  </div>
                  <div class="text-muted-foreground text-xs">
                    <span class="tabular-nums">{book.readerCount}</span> readers
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OwnershipSection() {
  return (
    <section class="px-4 py-20 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="bg-primary/5 border-primary/20 rounded-2xl border px-8 py-14">
          <div class="mx-auto max-w-3xl text-center">
            <div class="bg-primary/10 text-primary mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-7 w-7"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <p class="text-primary mb-3 text-sm font-semibold uppercase tracking-widest">
              Data Ownership
            </p>
            <h2 class="text-foreground text-4xl font-bold tracking-tight lg:text-5xl">
              Your data <span class="text-primary">always</span> belongs to you
            </h2>
            <p class="text-muted-foreground mt-5 text-lg">
              Every review you write, every book you track, every shelf you create; it's all stored
              in an open, portable format. Sign in with your existing Bluesky account, or create a
              new one. If BookHive ever shuts down, your data lives on.
            </p>
          </div>
          <div class="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Sign in with Bluesky",
                description:
                  "Use your existing Bluesky account, or create a new one. No new password to remember.",
                icon: <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
              },
              {
                title: "Open format",
                description:
                  "All your book data is stored on the AT Protocol, in an open format, accessible by other apps.",
                icon: (
                  <>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" x2="12" y1="15" y2="3" />
                  </>
                ),
              },
              {
                title: "No lock-in",
                description:
                  "Your library and reviews aren't trapped inside BookHive. Take them with you, wherever you go.",
                icon: (
                  <>
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" x2="3" y1="12" y2="12" />
                  </>
                ),
              },
            ].map((item) => (
              <div key={item.title} class="card">
                <div class="card-body space-y-3">
                  <div class="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-lg">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
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
                  <h3 class="text-foreground font-semibold">{item.title}</h3>
                  <p class="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function OpenSourceSection() {
  return (
    <section class="bg-card px-4 py-16 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <div class="bg-primary/10 text-primary flex h-14 w-14 shrink-0 items-center justify-center rounded-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
          </div>
          <div class="flex-1">
            <h2 class="text-foreground text-2xl font-bold">Built in the open</h2>
            <p class="text-muted-foreground mt-2">
              BookHive is 100% open source, from the code that runs the site to the book dataset it
              uses & publishes.
            </p>
          </div>
          <a
            href="https://github.com/nperez0111/bookhive"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-ghost shrink-0"
          >
            View on GitHub
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="ml-1.5 h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}

function ImportSection() {
  return (
    <section class="px-4 py-20 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-col items-center gap-12 lg:flex-row lg:items-center">
          <div class="flex-1">
            <p class="text-primary mb-3 text-sm font-semibold uppercase tracking-widest">
              Migration
            </p>
            <h2 class="text-foreground text-4xl font-bold tracking-tight lg:text-5xl">
              Bring your books <span class="text-primary">with you</span>
            </h2>
            <p class="text-muted-foreground mt-5 max-w-lg text-lg">
              Already have years of reading history on Goodreads or StoryGraph? Don't start from
              scratch. Export your data from closed platforms and import it straight into BookHive.
            </p>
            <div class="mt-8 flex flex-wrap gap-3">
              <a href="/import" class="btn btn-primary">
                Import your library
              </a>
            </div>
          </div>
          <div class="w-full lg:w-[40%]">
            <div class="card space-y-4 shadow-lg">
              <div class="card-body space-y-4">
                <h3 class="text-foreground font-semibold">Supported sources</h3>
                {[
                  {
                    name: "Goodreads",
                    description: "Export your library CSV and import everything",
                  },
                  {
                    name: "StoryGraph",
                    description: "Bring over your reading history and reviews",
                  },
                ].map((source) => (
                  <div
                    key={source.name}
                    class="flex items-start gap-3 rounded-lg p-3 shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(0,0,0,0.04)]"
                  >
                    <div class="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" x2="12" y1="3" y2="15" />
                      </svg>
                    </div>
                    <div>
                      <div class="text-foreground text-sm font-semibold">{source.name}</div>
                      <div class="text-muted-foreground text-xs">{source.description}</div>
                    </div>
                  </div>
                ))}
                <p class="text-muted-foreground text-xs">Your data. Your history. Yours to keep.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta({ signupUrl }: { signupUrl: string }) {
  return (
    <section class="bg-primary px-4 py-20 lg:px-8">
      <div class="mx-auto max-w-3xl text-center">
        <h2 class="text-primary-foreground text-4xl font-bold tracking-tight lg:text-5xl">
          Ready to join the hive?
        </h2>
        <p class="text-primary-foreground/80 mt-5 text-lg">
          Join a growing community of readers who believe your library should be open, social, and
          entirely yours.
        </p>
        <div class="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href="/login"
            class="btn bg-primary-foreground text-primary hover:bg-primary-foreground/90"
          >
            Sign in with Bluesky
          </a>
          <a
            href={signupUrl}
            class="btn border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 border bg-transparent shadow-none"
          >
            Create a free account
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer class="bg-card border-border border-t px-4 py-10 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <a href="/" class="flex items-center gap-2">
            <img src="/book.svg" alt="" width="22" height="22" />
            <span class="text-foreground font-bold">BookHive</span>
          </a>
          <nav class="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {[
              { label: "Explore", href: "/genres" },
              { label: "Import", href: "/import" },
              { label: "Privacy", href: "/privacy-policy" },
              { label: "Terms", href: "/legal" },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                class="text-muted-foreground hover:text-foreground min-h-[40px] inline-flex items-center text-sm transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <p class="text-muted-foreground text-sm">© {new Date().getFullYear()} BookHive</p>
        </div>
      </div>
    </footer>
  );
}

export const MarketingPage: FC<{
  signupUrl: string;
  recentActivity: RecentActivityItem[];
  didHandleMap: Record<string, string>;
  profileByDid: Record<string, ProfileViewDetailed>;
  trendingBooks: TrendingBook[];
}> = ({ signupUrl, recentActivity, didHandleMap, profileByDid, trendingBooks }) => {
  return (
    <div class="bg-background min-h-screen">
      <MarketingNav signupUrl={signupUrl} />
      <Hero signupUrl={signupUrl} />
      <SocialSection
        activities={recentActivity}
        didHandleMap={didHandleMap}
        profileByDid={profileByDid}
      />
      <LibrarySection />
      <DiscoverSection trendingBooks={trendingBooks} />
      <OwnershipSection />
      <OpenSourceSection />
      <ImportSection />
      <FinalCta signupUrl={signupUrl} />
      <Footer />
    </div>
  );
};
