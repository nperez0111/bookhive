import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import { BookFields } from "../db";
import type { Book } from "../types";
import { hydrateUserBook } from "../utils/bookProgress";
import { BOOK_STATUS } from "../constants";
import { BookCard, normalizeBookData } from "./components/BookCard";
import { sql } from "kysely";

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
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  startTime(c, "homeQueries");
  const [currentlyReadingRows, wantToReadRows, statsRow] = await Promise.all([
    ctx.db
      .selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(BookFields)
      .where("user_book.userDid", "=", profile.did)
      .where("user_book.status", "=", BOOK_STATUS.READING)
      .orderBy("user_book.indexedAt", "desc")
      .limit(20)
      .execute(),

    ctx.db
      .selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(BookFields)
      .where("user_book.userDid", "=", profile.did)
      .where("user_book.status", "=", BOOK_STATUS.WANTTOREAD)
      .orderBy("user_book.createdAt", "desc")
      .limit(20)
      .execute(),

    ctx.db
      .selectFrom("user_book")
      .where("user_book.userDid", "=", profile.did)
      .select([
        sql<number>`sum(case when status = ${BOOK_STATUS.FINISHED} then 1 else 0 end)`.as(
          "totalRead",
        ),
        sql<number>`sum(case when status = ${BOOK_STATUS.FINISHED} and "finishedAt" >= ${yearStart} then 1 else 0 end)`.as(
          "thisYear",
        ),
        sql<number>`sum(case when status = ${BOOK_STATUS.FINISHED} and "finishedAt" >= ${monthStart} then 1 else 0 end)`.as(
          "thisMonth",
        ),
      ])
      .executeTakeFirst(),
  ]);
  endTime(c, "homeQueries");

  const currentlyReading = currentlyReadingRows.map((row) => hydrateUserBook(row));
  const wantToRead = wantToReadRows.map((row) => hydrateUserBook(row));
  const stats = {
    totalRead: Number(statsRow?.totalRead) || 0,
    thisMonth: Number(statsRow?.thisMonth) || 0,
    thisYear: Number(statsRow?.thisYear) || 0,
  };

  const displayName = profile.displayName ?? profile.handle ?? "there";

  return (
    <div class="space-y-8 px-4 pt-6 sm:space-y-10 sm:pt-8 lg:px-8">
      <div class="flex items-center justify-between">
        <h2 class="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
          Welcome back, {displayName}
        </h2>
      </div>

      {/* Quick Stats */}
      <div class="card">
        <div class="card-header flex items-center justify-between">
          <h2 class="card-title">Quick Stats</h2>
          <a
            href={`/profile/${profile.handle}/stats`}
            class="text-primary text-sm hover:underline"
          >
            See full stats →
          </a>
        </div>
        <div class="card-body">
          <div class="grid grid-cols-3 gap-4 text-center">
            <div>
              <div class="text-foreground text-2xl font-bold">{stats.totalRead}</div>
              <div class="text-muted-foreground text-xs">Total Read</div>
            </div>
            <div>
              <div class="text-foreground text-2xl font-bold">{stats.thisMonth}</div>
              <div class="text-muted-foreground text-xs">This Month</div>
            </div>
            <div>
              <div class="text-foreground text-2xl font-bold">{stats.thisYear}</div>
              <div class="text-muted-foreground text-xs">This Year</div>
            </div>
          </div>
        </div>
      </div>

      {/* Currently Reading */}
      <section>
        <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">Currently Reading</h2>
        {currentlyReading.length > 0 ? (
          <BookGrid books={currentlyReading as Book[]} />
        ) : (
          <div class="card">
            <div class="card-body text-center">
              <p class="text-muted-foreground">
                You're not reading anything right now.{" "}
                <a href="/explore" class="text-primary hover:underline">
                  Find your next book
                </a>
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Want to Read */}
      <section>
        <h2 class="text-foreground mb-4 text-2xl font-bold tracking-tight">Want to Read</h2>
        {wantToRead.length > 0 ? (
          <BookGrid books={wantToRead as Book[]} />
        ) : (
          <div class="card">
            <div class="card-body text-center">
              <p class="text-muted-foreground">
                Your reading list is empty.{" "}
                <a href="/explore" class="text-primary hover:underline">
                  Explore books
                </a>{" "}
                or{" "}
                <a href="/import" class="text-primary hover:underline">
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
