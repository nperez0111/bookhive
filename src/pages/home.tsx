import { type FC, Fragment } from "hono/jsx";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";
import { useRequestContext } from "hono/jsx-renderer";
import { formatDistanceToNow } from "date-fns";
import * as BookStatus from "../bsky/lexicon/types/buzz/bookhive/defs";
import { BOOK_STATUS_MAP } from "../constants";
import { endTime, startTime } from "hono/timing";

type Props = {
  didHandleMap?: Record<string, string>;
  profile?: ProfileViewDetailed;
};

function Hero() {
  return (
    <main class="grid place-items-center pt-16 pb-8 md:pt-12 md:pb-24 lg:grid-cols-2">
      <div class="hidden py-6 md:order-1 md:block">
        <img
          src={`/public/bee.svg`}
          alt="Bee sitting on a stack of books"
          className="w-full max-w-[620px] rounded-xl object-cover sm:w-auto md:max-w-[600px] lg:max-w-[620px]"
        />
      </div>
      <div>
        <h1 class="text-5xl font-bold lg:text-6xl lg:tracking-tight xl:text-7xl xl:tracking-tighter">
          The social platform for book lovers
        </h1>
        <p class="mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-400">
          You can follow your friends and see what they are reading, and you can
          also discover new books and authors.
          <wbr /> Powered by the AT protocol, which means you own your data.
        </p>
        <div class="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href="#"
            target="_blank"
            class="flex items-center justify-center gap-1"
            rel="noopener"
          >
            {/* <Icon class="h-5 w-5 text-white" name="bx:bxs-cloud-download" /> */}
            Download for Free
          </a>
          <a
            size="lg"
            style="outline"
            rel="noopener"
            href="#"
            class="flex items-center justify-center gap-1"
            target="_blank"
          >
            {/* <Icon class="h-4 w-4 text-black" name="bx:bxl-github" /> */}
            GitHub Repo
          </a>
        </div>
      </div>
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
        "Book Hive is built on top of the AT protocol, which means you own your data.",
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
    <Fragment>
      <div class="mt-16 md:mt-0">
        <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
          Everything you need to manage your books
        </h2>
        <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Book Hive stores all of your books in your own personal library.
        </p>
      </div>

      <div class="mt-16 grid gap-16 sm:grid-cols-2 md:grid-cols-3">
        {features.map((item) => (
          <div class="flex items-start gap-4">
            <div class="mt-1 flex shrink-0 items-center justify-center rounded-full bg-black p-2">
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
    </Fragment>
  );
}

async function LatestActivity() {
  const c = useRequestContext();
  startTime(c, "latestBuzzes");

  const latestBuzzes = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .selectAll()
    .orderBy("createdAt", "desc")
    .limit(100)
    .execute();
  endTime(c, "latestBuzzes");

  startTime(c, "didHandleMap");
  const didHandleMap = await c
    .get("ctx")
    .resolver.resolveDidsToHandles(latestBuzzes.map((s) => s.userDid));
  endTime(c, "didHandleMap");

  return (
    <div class="mt-16 flex flex-col gap-2">
      <div class="mb-6">
        <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
          Recent buzzes
        </h2>
        <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
          See what others are reading and what they think about it.
        </p>
      </div>
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
    <div class="container mx-auto max-w-7xl bg-slate-50 px-3 lg:px-8 dark:bg-slate-900 dark:text-white">
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
