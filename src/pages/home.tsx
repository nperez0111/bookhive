import { type FC, Fragment } from "hono/jsx";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";
import { useRequestContext } from "hono/jsx-renderer";
import { formatDistanceToNow } from "date-fns";
import * as BookStatus from "../bsky/lexicon/types/buzz/bookhive/defs";
import { BOOK_STATUS_PAST_TENSE_MAP } from "../constants";
import { endTime, startTime } from "hono/timing";
import { BookFields } from "../db";
import { FallbackCover } from "./components/fallbackCover";

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
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {latestBuzzes.map((book) => (
          <div class="rounded-lg border border-gray-200 bg-white shadow dark:border-gray-700 dark:bg-gray-800">
            <a href={`/books/${book.hiveId}`} class="block h-72 w-full">
              {book.cover || book.thumbnail ? (
                <img
                  src={book.cover || book.thumbnail || ""}
                  alt={book.title}
                  className="h-full w-full rounded-lg object-cover"
                />
              ) : (
                <FallbackCover className="h-full w-full" />
              )}
            </a>

            <a
              href={`/profile/${didHandleMap[book.userDid]}`}
              class="cursor-pointer"
            >
              <div class="mt-5 px-3 pb-5">
                <h5 class="line-clamp-2 text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                  {book.title}
                </h5>
                <div className="flex items-center">
                  <div className="-ml-1 flex -space-x-1.5">
                    {book.stars &&
                      [1, 2, 3, 4, 5].map((star) => (
                        <svg
                          class="relative inline-flex w-6"
                          viewBox="0 0 24 24"
                          key={star}
                        >
                          {/* Background star (gray) */}
                          <path
                            class="fill-current text-gray-300"
                            d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                          />
                          {/* Filled star (yellow) with clip */}
                          <path
                            style={{
                              clipPath: `inset(0 ${
                                100 -
                                Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    ((book.stars || 0) / 2 - (star - 1)) * 100,
                                  ),
                                )
                              }% 0 0)`,
                            }}
                            class="fill-current text-yellow-400"
                            d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                          />
                        </svg>
                      ))}
                  </div>
                  {book.stars && (
                    <span class="ms-3 rounded bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-200 dark:text-blue-800">
                      {book.stars / 2}
                    </span>
                  )}
                </div>
                <span class="line-clamp-1 block font-semibold text-ellipsis">
                  @{didHandleMap[book.userDid]}
                </span>
                {book.status && book.status in BOOK_STATUS_PAST_TENSE_MAP
                  ? BOOK_STATUS_PAST_TENSE_MAP[
                      book.status as keyof typeof BOOK_STATUS_PAST_TENSE_MAP
                    ]
                  : book.status ||
                    BOOK_STATUS_PAST_TENSE_MAP[BookStatus.READING]}{" "}
                <span class="text-slate-700 dark:text-slate-200">
                  {formatDistanceToNow(book.indexedAt, { addSuffix: true })}
                </span>
                {book.review && book.review.length > 0 && (
                  <span> and reviewed it</span>
                )}
              </div>
            </a>
          </div>
        ))}
      </div>
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
        <div class="flex flex-col gap-2 px-4 pt-16 lg:px-8">
          <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
            Your books
          </h2>
          <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
            Here are the books you have added to your library.
          </p>
          <div class="mt-8">
            <BookList />
          </div>
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
