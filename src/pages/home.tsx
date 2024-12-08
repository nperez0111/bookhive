/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement, Fragment } from "hono/jsx";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";
import { useRequestContext } from "hono/jsx-renderer";
import { formatDistanceToNow } from "date-fns";
import * as BookStatus from "../bsky/lexicon/types/buzz/bookhive/defs";
import { BOOK_STATUS_MAP } from "../constants";

type Props = {
  didHandleMap?: Record<string, string>;
  profile?: ProfileViewDetailed;
};

export const Home: FC<Props> = async () => {
  const c = useRequestContext();

  const agent = await c.get("ctx").getSessionAgent();
  const profile = await c.get("ctx").getProfile();

  const myBooks = agent
    ? await c
        .get("ctx")
        .db.selectFrom("user_book")
        .innerJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .selectAll()
        .where("user_book.userDid", "=", agent.assertDid)
        .orderBy("user_book.indexedAt", "desc")
        .limit(10)
        .execute()
    : [];

  const latestBuzzes = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .selectAll()
    .orderBy("indexedAt", "desc")
    .limit(25)
    .execute();

  const didHandleMap = await c
    .get("ctx")
    .resolver.resolveDidsToHandles(latestBuzzes.map((s) => s.userDid));

  return (
    <div class="container mx-auto h-[calc(100vh-64px)] max-w-7xl bg-slate-50 px-3 dark:bg-slate-900 dark:text-white">
      <div class="flex justify-center">
        {profile ? (
          <h1 class="mt-3 mb-2 text-3xl">
            👋, <span class="font-bold">{profile.displayName || "friend"}</span>
            , welcome back to Book Hive 🐝!
          </h1>
        ) : (
          <h1 class="mt-3 mb-2 text-3xl">👋, Welcome to the Book Hive 🐝!</h1>
        )}
      </div>
      {profile ? (
        <div>
          <h2 class="text-md mt-3 mb-6 text-2xl leading-12 font-bold">
            Your books
          </h2>
          <BookList books={myBooks} />
        </div>
      ) : (
        <div>
          <h2 class="text-md mt-3 mb-6 text-2xl leading-12 font-bold">
            What is book hive?
          </h2>
          <article class="flex flex-col gap-10 px-3 md:flex-row">
            <p class="flex-1">
              Book Hive is a social platform for book lovers to share what they
              are reading, what they have read, and what they want to read. You
              can follow your friends and see what they are reading, and you can
              also discover new books and authors.
            </p>
            <p class="flex-1">
              Everything is built on top of the AT protocol, which powers Blue
              Sky. This means that you own your data and can take it with you
              wherever you want.
            </p>
          </article>
        </div>
      )}
      <div class="mt-16 flex flex-col gap-2">
        <h2 class="text-md mt-3 mb-6 text-2xl leading-12 font-bold">
          Recent buzzes
        </h2>
        {latestBuzzes.map((book) => {
          const handle = didHandleMap[book.userDid] || book.userDid;
          return (
            <div
              key={book.userDid}
              class="rounded-xl border border-slate-400 px-2 py-2"
            >
              <a
                href={`/profile/${handle}`}
                class="inline text-blue-600 hover:underline"
              >
                @{handle}
              </a>{" "}
              - marked{" "}
              <a
                href={`/books/${book.hiveId}`}
                class="inline text-blue-600 hover:underline"
              >
                "
                {book.title.slice(0, 40) +
                  (book.title.length > 40 ? "..." : "")}
                " by {book.authors.split("\t").join(", ")}
              </a>{" "}
              as{" "}
              {book.status && book.status in BOOK_STATUS_MAP
                ? BOOK_STATUS_MAP[book.status as keyof typeof BOOK_STATUS_MAP]
                : book.status || BOOK_STATUS_MAP[BookStatus.READING]}{" "}
              {formatDistanceToNow(book.indexedAt, { addSuffix: true })}
              {book.stars && <span> - rated {book.stars / 2}</span>}
              {book.review && <span> - reviewed</span>}
            </div>
          );
        })}
      </div>
      <div class="mt-16 text-center text-gray-500">
        See this project&nbsp;
        <a
          href="https://github.com/nperez0111/book-hive"
          class="text-blue-600 hover:underline"
        >
          on GitHub
        </a>
        , built by{" "}
        <a href="https://nickthesick.com" class="text-blue-600 hover:underline">
          Nick The Sick
        </a>
      </div>
    </div>
  );
};
