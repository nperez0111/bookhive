import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import type { Book } from "../types";
import { BOOK_STATUS } from "../constants";
import { BookCard, normalizeBookData } from "./components/BookCard";
import { getReadingCounts, listShelf } from "../data/userShelves";

function BookGrid({ books }: { books: Book[] }) {
  return (
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {books.map((book) => (
        <BookCard key={book.hiveId} variant="dense" book={normalizeBookData(book)} />
      ))}
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

  const ctx = c.get("ctx");

  startTime(c, "homeQueries");
  const [currentlyReading, wantToRead, stats] = await Promise.all([
    listShelf({ db: ctx.db, userDid: profile.did, status: BOOK_STATUS.READING }),
    // A queue, so ordered by when it was added — not by activity.
    listShelf({
      db: ctx.db,
      userDid: profile.did,
      status: BOOK_STATUS.WANTTOREAD,
      orderBy: "createdAt",
    }),
    getReadingCounts({ db: ctx.db, userDid: profile.did }),
  ]);
  endTime(c, "homeQueries");

  const displayName = profile.displayName ?? profile.handle ?? "there";

  return (
    <div class="space-y-8 px-4 pt-6 sm:space-y-10 sm:pt-8 lg:px-8">
      <div class="flex items-center justify-between">
        <h2 class="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
          Welcome back, {displayName}
        </h2>
      </div>

      <div class="card">
        <div class="card-header flex items-center justify-between">
          <h2 class="card-title">Quick Stats</h2>
          <a
            href={`/profile/${profile.handle}/stats`}
            class="text-primary min-h-10 inline-flex items-center text-sm hover:underline active:scale-[0.96] transition-[transform] duration-150"
          >
            See full stats →
          </a>
        </div>
        <div class="card-body">
          <div class="grid grid-cols-3 gap-4 text-center">
            <div>
              <div class="text-foreground text-2xl font-bold tabular-nums">{stats.totalRead}</div>
              <div class="text-muted-foreground text-xs">Total Read</div>
            </div>
            <div>
              <div class="text-foreground text-2xl font-bold tabular-nums">{stats.thisMonth}</div>
              <div class="text-muted-foreground text-xs">This Month</div>
            </div>
            <div>
              <div class="text-foreground text-2xl font-bold tabular-nums">{stats.thisYear}</div>
              <div class="text-muted-foreground text-xs">This Year</div>
            </div>
          </div>
        </div>
      </div>

      <section>
        <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">Currently Reading</h2>
        {currentlyReading.length > 0 ? (
          <BookGrid books={currentlyReading as Book[]} />
        ) : (
          <div class="card">
            <div class="card-body text-center">
              <p class="text-muted-foreground">
                You're not reading anything right now.{" "}
                <a
                  href="/explore"
                  class="text-primary inline-flex min-h-10 items-center hover:underline"
                >
                  Find your next book
                </a>
              </p>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">Want to Read</h2>
        {wantToRead.length > 0 ? (
          <BookGrid books={wantToRead as Book[]} />
        ) : (
          <div class="card">
            <div class="card-body text-center">
              <p class="text-muted-foreground">
                Your reading list is empty.{" "}
                <a
                  href="/explore"
                  class="text-primary inline-flex min-h-10 items-center hover:underline"
                >
                  Explore books
                </a>{" "}
                or{" "}
                <a
                  href="/import"
                  class="text-primary inline-flex min-h-10 items-center hover:underline"
                >
                  import your library
                </a>
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
