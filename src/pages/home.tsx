import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import type { Book } from "../types";
import { BOOK_STATUS } from "../constants";
import { BookCard, normalizeBookData } from "./components/BookCard";
import { getReadingCounts, listShelf } from "../data/userShelves";

function BookGrid({ books }: { books: Book[] }) {
  return (
    <ul class="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 lg:gap-x-5">
      {books.map((book) => (
        <li key={book.hiveId} class="min-w-0">
          <BookCard variant="dense" showAuthor reserveTextSpace book={normalizeBookData(book)} />
        </li>
      ))}
    </ul>
  );
}

function ReadingSection({
  title,
  description,
  books,
  emptyMessage,
  action,
}: {
  title: string;
  description: string;
  books: Book[];
  emptyMessage: string;
  action?: { href: string; label: string };
}) {
  return (
    <section aria-label={title}>
      <div class="mb-5">
        <div class="flex items-center gap-3">
          <h2 class="text-foreground text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
          {books.length > 0 && (
            <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {books.length}
            </span>
          )}
        </div>
        <p class="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {books.length ? (
        <BookGrid books={books} />
      ) : (
        <div class="card empty">
          <p class="empty-description">{emptyMessage}</p>
          {action && (
            <a href={action.href} class="btn btn-outline mt-4 min-h-10">
              {action.label}
            </a>
          )}
        </div>
      )}
    </section>
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

  const ctx = c.get("ctx");

  startTime(c, "homeQueries");
  const [currentlyReading, wantToRead, finished, stats] = await Promise.all([
    listShelf({ db: ctx.db, userDid: profile.did, status: BOOK_STATUS.READING }),
    // A queue, so ordered by when it was added — not by activity.
    listShelf({
      db: ctx.db,
      userDid: profile.did,
      status: BOOK_STATUS.WANTTOREAD,
      orderBy: "createdAt",
    }),
    listShelf({
      db: ctx.db,
      userDid: profile.did,
      status: BOOK_STATUS.FINISHED,
      orderBy: "finishedAt",
    }),
    getReadingCounts({ db: ctx.db, userDid: profile.did }),
  ]);
  endTime(c, "homeQueries");

  const displayName = profile.displayName ?? profile.handle ?? "there";

  return (
    <div class="space-y-10 px-4 py-6 sm:space-y-12 sm:py-8 lg:px-8">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-foreground text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            Welcome back, {displayName}
          </h1>
          <p class="mt-2 text-muted-foreground">Your reading life, at a glance.</p>
        </div>
        <a href="/search" data-open-search class="btn btn-primary min-h-10">
          Find a book
        </a>
      </div>

      <div class="card">
        <div class="card-header flex items-center justify-between">
          <h2 class="card-title">Reading at a glance</h2>
          <a
            href={`/profile/${profile.handle}/stats`}
            class="focus-ring text-primary min-h-10 inline-flex items-center text-sm hover:underline active:scale-[0.96] transition-[transform] duration-150"
          >
            See full stats →
          </a>
        </div>
        <div class="card-body">
          <dl class="grid grid-cols-3 divide-x divide-border text-center">
            <div>
              <dt class="text-muted-foreground text-xs">All-time reads</dt>
              <dd class="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                {stats.totalRead}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-xs">This month</dt>
              <dd class="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                {stats.thisMonth}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-xs">This year</dt>
              <dd class="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                {stats.thisYear}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <ReadingSection
        title="Currently Reading"
        description="Pick up where you left off."
        books={currentlyReading as Book[]}
        emptyMessage="You're not reading anything right now. Your next chapter is waiting."
        action={
          wantToRead.length
            ? { href: "/my-books", label: "Choose from your books" }
            : { href: "/explore", label: "Discover your next read" }
        }
      />
      <ReadingSection
        title="Want to Read"
        description="Good books to look forward to."
        books={wantToRead as Book[]}
        emptyMessage="Keep a book here whenever it catches your eye."
        action={{ href: "/explore", label: "Explore books" }}
      />
      <ReadingSection
        title="Finished Reading"
        description="Your latest finishes, most recent first."
        books={finished as Book[]}
        emptyMessage="Books you finish will appear here. Every reading journey starts with one."
      />
    </div>
  );
};
