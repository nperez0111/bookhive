import { type FC, Fragment } from "hono/jsx";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";
import { useRequestContext } from "hono/jsx-renderer";
import { formatDistanceToNow } from "date-fns";
import * as BookStatus from "../bsky/lexicon/types/buzz/bookhive/defs";
import { BOOK_STATUS_MAP } from "../constants";
import { endTime, startTime } from "hono/timing";
import { BookFields } from "../db";
// import { FallbackCover } from "./components/fallbackCover";

type Props = {
  didHandleMap?: Record<string, string>;
  profile?: ProfileViewDetailed;
};

function Hero() {
  return (
    <main class="relative grid place-items-center px-4 pt-16 pb-8 md:pt-12 md:pb-24 lg:grid-cols-2 lg:px-8">
      <div class="relative z-10 flex justify-center py-6 sm:block lg:order-1">
        <img
          src={`/public/bee.svg`}
          alt="Bee sitting on a stack of books"
          className="max-h-[200px] w-[70%] max-w-[620px] rounded-xl object-cover sm:w-auto md:max-w-[600px] lg:max-w-[620px]"
        />
      </div>
      <div class="relative z-10">
        <h1 class="text-5xl font-bold lg:text-6xl lg:tracking-tight xl:text-7xl xl:tracking-tighter">
          The social platform for{" "}
          <span class="text-blue-600 dark:text-blue-500">book lovers</span>
        </h1>
        <p class="mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-400">
          You can follow your friends and see what they are reading, and you can
          also discover new books and authors.
          <wbr /> Powered by the AT protocol, which means you own your data.
        </p>
        <div class="mt-6 flex flex-col gap-3 sm:flex-row">
          {/* Something here */}
        </div>
      </div>
      <div class="absolute top-0 left-0 z-0 h-full w-full bg-gradient-to-b from-blue-50 to-transparent dark:from-blue-900"></div>
    </main>
  );
}

function Features() {
  const features = [
    {
      title: "Manage your books",
      description:
        "Add books to your library, mark them as read, reading, or want to read.",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
      ),
    },
    {
      title: "Follow your friends",
      description:
        "Follow your friends and see what they are reading and what they have read.",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      title: "Discover new books",
      description:
        "Discover new books and authors based on what you and your friends are reading.",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M10 10h4" />
          <path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3" />
          <path d="M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z" />
          <path d="M 22 16 L 2 16" />
          <path d="M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z" />
          <path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3" />
        </svg>
      ),
    },
    {
      title: "Rate and review",
      description:
        "Rate books out of 5 stars and leave a review to share with your friends.",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
        </svg>
      ),
    },
    {
      title: "Own your data",
      description:
        "BookHive is built on top of the AT protocol, which means you own your data.",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          <path d="M12 10v6" />
          <path d="m15 13-3 3-3-3" />
        </svg>
      ),
    },
  ];

  return (
    <div class="px-4 lg:px-8">
      <div class="mt-16 text-center text-balance md:mt-0 lg:mx-0">
        <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
          Everything you need to{" "}
          <span class="underline decoration-yellow-400 decoration-4 underline-offset-4 dark:decoration-yellow-600">
            manage your books
          </span>
        </h2>
        <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
          BookHive stores all of your books in your own personal library.
        </p>
      </div>

      <div class="mt-16 grid gap-16 sm:grid-cols-2 md:grid-cols-3">
        {features.map((item) => (
          <div class="flex items-start gap-4">
            <div class="mt-1 flex shrink-0 items-center justify-center rounded-full bg-yellow-500 p-2 text-black">
              {item.icon}
            </div>
            <div>
              <h3 class="text-lg font-semibold">{item.title}</h3>{" "}
              <p class="mt-2 leading-relaxed text-slate-500 dark:text-slate-300">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function LatestActivity() {
  const c = useRequestContext();
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

  startTime(c, "didHandleMap");
  const didHandleMap = await c
    .get("ctx")
    .resolver.resolveDidsToHandles(latestBuzzes.map((s) => s.userDid));
  endTime(c, "didHandleMap");

  // const book = latestBuzzes[24];

  return (
    <div class="mt-16 flex flex-col gap-2 px-4 lg:px-8">
      <div class="mb-6">
        <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
          Recent buzzes
        </h2>
        <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
          See what others are reading and what they think about it.
        </p>
      </div>
      {/* <ol class="relative border-s border-gray-200 dark:border-gray-700">
        {latestBuzzes.map((book) => {
          return (
            <li class="ms-4 mb-10">
              <div class="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-gray-200 dark:border-gray-900 dark:bg-gray-700"></div>
              <time class="mb-1 text-sm leading-none font-normal text-gray-400 dark:text-gray-500">
                {formatDistanceToNow(book.indexedAt, { addSuffix: true })}
              </time>
              <div class="mt-3 flex gap-3">
                {book.cover || book.thumbnail ? (
                  <img
                    src={book.cover || book.thumbnail || ""}
                    alt={book.title}
                    class="h-36 w-24 rounded-lg object-cover shadow-sm"
                  />
                ) : (
                  <FallbackCover className="h-36 w-24 rounded-lg object-cover shadow-sm" />
                )}
                <div>
                  <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                    {book.title}
                  </h3>
                  <span class="text-sm text-slate-600 dark:text-slate-400">
                    by {book.authors.split("\t").join(", ")}
                    {book.stars ? (
                      <span class="text-md mx-1 text-slate-800 dark:text-slate-200">
                        ({book.stars / 2} ⭐)
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol> */}
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
              "{book.title.slice(0, 40) + (book.title.length > 40 ? "..." : "")}
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
  );
}

export const Home: FC<Props> = async () => {
  const c = useRequestContext();

  startTime(c, "profile");
  const profile = await c.get("ctx").getProfile();
  endTime(c, "profile");

  return (
    <div class="container mx-auto max-w-7xl bg-slate-50 dark:bg-slate-900 dark:text-white">
      {profile ? (
        <div>
          <h2 class="text-md mt-3 mb-6 text-2xl leading-12 font-bold">
            Your books
          </h2>
          <BookList />
        </div>
      ) : (
        <Fragment>
          <Hero />
          <Features />
        </Fragment>
      )}
      <LatestActivity />
      <div class="my-16 text-center text-gray-500">
        See this project&nbsp;
        <a
          href="https://github.com/nperez0111/bookhive"
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
