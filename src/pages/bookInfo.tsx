/** @jsx createElement */
import {
  type FC,
  type PropsWithChildren,
  // @ts-ignore
  createElement,
  Fragment,
} from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { formatDistanceToNow } from "date-fns";
import { Navbar } from "./navbar";
import * as Profile from "../bsky/lexicon/types/app/bsky/actor/profile";
import type { BookResult } from "../scrapers";
import * as BookStatus from "../bsky/lexicon/types/buzz/bookhive/defs";

const BOOK_STATUS_MAP = {
  [BookStatus.ABANDONED]: "abandoned",
  [BookStatus.READING]: "currently reading",
  [BookStatus.WANTTOREAD]: "want to read",
  [BookStatus.OWNED]: "owned",
  [BookStatus.FINISHED]: "finished",
};

async function Recommendations({
  book,
  // did,
}: {
  book: BookResult;
  did: string | null;
}) {
  const c = useRequestContext();
  const relatedBooks = await c
    .get("ctx")
    .db.selectFrom("book")
    .selectAll()
    .where("book.hiveId", "==", book.id)
    // .where("authorDid", "!=", did)
    .limit(10)
    .execute();

  const didHandleMap = await c
    .get("ctx")
    .resolver.resolveDidsToHandles(relatedBooks.map((s) => s.authorDid));

  // const nonAuthorRelatedBooks = relatedBooks.filter(
  //   (related) => related.authorDid !== did,
  // );

  if (!relatedBooks.length) {
    return (
      <div class="rounded-xl bg-gray-900 px-2 py-5 text-center">
        Be the first to read this on bookhive!
      </div>
    );
  }

  // if (nonAuthorRelatedBooks.length === 0) {
  //   return (
  //     <div class="rounded-xl bg-gray-900 px-2 py-5 text-center">
  //       First to read this book on bookhive!
  //     </div>
  //   );
  // }

  return (
    <Fragment>
      <h3 class="my-5 px-2 text-xl leading-2">
        Who else is reading this book?
      </h3>
      <div class="flex flex-col gap-2">
        {relatedBooks.map((related) => {
          const handle = didHandleMap[related.authorDid] || related.authorDid;
          return (
            <a
              key={related.authorDid}
              href={`/profile/${handle}`}
              class="block cursor-pointer rounded-sm border border-slate-400 px-2 py-2 hover:bg-slate-700"
            >
              <span class="text-blue-600">@{handle}</span> - marked as{" "}
              {related.status && related.status in BOOK_STATUS_MAP
                ? BOOK_STATUS_MAP[
                    related.status as keyof typeof BOOK_STATUS_MAP
                  ]
                : related.status || BOOK_STATUS_MAP[BookStatus.READING]}{" "}
              {formatDistanceToNow(related.createdAt)} ago
            </a>
          );
        })}
      </div>
    </Fragment>
  );
}

const BookForm: FC<
  PropsWithChildren<{
    book: BookResult;
    status: (typeof BookStatus)[keyof typeof BookStatus];
  }>
> = ({ book, children, status }) => {
  return (
    <form action="/books" method="post" class="mt-4">
      <input type="hidden" name="author" value={book.authors.join(", ")} />
      <input type="hidden" name="title" value={book.title} />
      {book.publishedDate && (
        <input
          type="hidden"
          name="year"
          value={new Date(book.publishedDate).getFullYear()}
        />
      )}
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="hiveId" value={book.id} />
      <input type="hidden" name="coverImage" value={book.cover} />
      {children}
    </form>
  );
};

export const BookInfo: FC<{
  profile?: Profile.Record;
  profileAvatar?: string;
  book: BookResult;
}> = async ({ profile, profileAvatar, book }) => {
  const c = useRequestContext();
  const did =
    (await c.get("ctx").getSessionAgent(c.req.raw, c.res))?.did ?? null;

  const usersBook = await c
    .get("ctx")
    .db.selectFrom("book")
    .selectAll()
    .where("authorDid", "==", did)
    .where("book.hiveId", "==", book.id)
    .executeTakeFirst();
  return (
    <Fragment>
      <Navbar
        tab="home"
        profileAvatar={profileAvatar}
        hasProfile={Boolean(profile)}
      />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Left Column - Book Info */}
          <div className="lg:w-3/4">
            <div className="mb-8 flex flex-col gap-8 rounded-xl bg-gray-900 p-6 shadow-md md:flex-row">
              <div className="w-full p-1 md:w-1/3 lg:w-1/4">
                <div className="relative m-0 grid cursor-default break-inside-avoid p-4">
                  {/* From: https://codepen.io/mardisstudio/pen/ExBqRqE and converted to Tailwind */}
                  <div className="relative">
                    {/* Book spine/inside effect */}
                    <div className="absolute top-[1%] left-4 h-[96%] w-[90%] rounded-r-md border border-gray-400 bg-white shadow-[10px_40px_40px_-10px_rgba(0,0,0,0.12),inset_-2px_0_0_gray,inset_-3px_0_0_#dbdbdb,inset_-4px_0_0_white,inset_-5px_0_0_#dbdbdb,inset_-6px_0_0_white,inset_-7px_0_0_#dbdbdb,inset_-8px_0_0_white,inset_-9px_0_0_#dbdbdb]" />

                    {/* Book cover with image */}
                    <div className="relative -translate-x-[10px] scale-x-[0.94] -rotate-y-[15deg] transform cursor-pointer rounded-r-md leading-none shadow-[6px_6px_18px_-2px_rgba(0,0,0,0.2),24px_28px_40px_-6px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out perspective-[2000px] hover:translate-x-0 hover:scale-x-100 hover:rotate-y-0 hover:shadow-[6px_6px_12px_-1px_rgba(0,0,0,0.1),20px_14px_16px_-6px_rgba(0,0,0,0.1)]">
                      <img
                        src={book.cover || book.thumbnail}
                        alt={`Cover of ${book.title}`}
                        className="col-span-1 row-span-full aspect-2/3 w-full rounded-r-md object-cover"
                      />

                      {/* Light effect overlay */}
                      <div className="absolute top-0 z-[5] ml-4 h-full w-5 border-l-2 border-black/5 bg-gradient-to-r from-white/20 to-transparent transition-all duration-500 group-hover:ml-[14px]" />

                      {/* Shine effect */}
                      <div className="absolute top-0 right-0 z-[4] h-full w-[90%] rounded bg-gradient-to-r from-transparent to-white/20 opacity-10 transition-all duration-500" />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-center">
                  <a
                    href={book.url}
                    className="flex justify-between gap-3 rounded-md border border-slate-600 p-2 hover:bg-slate-800"
                  >
                    Goodreads
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
                      <path d="m21 3-9 9" />
                      <path d="M15 3h6v6" />
                    </svg>
                  </a>
                </div>
              </div>

              <div className="flex-1">
                <h1 className="mb-2 text-3xl font-bold dark:text-gray-100">
                  {book.title}
                </h1>
                <p className="mb-4 text-xl dark:text-gray-400">
                  by {book.authors.join(", ")}
                </p>

                <div className="mb-6 flex items-center gap-1">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg
                        class="relative inline-flex w-8"
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
                            clipPath: `inset(0 ${100 - Math.min(100, Math.max(0, ((book.rating || 0) - (star - 1)) * 100))}% 0 0)`,
                          }}
                          class="fill-current text-yellow-300"
                          d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                        />
                      </svg>
                    ))}
                  </div>
                  {book.rating && (
                    <span className="text-lg font-semibold">{book.rating}</span>
                  )}
                  {book.ratingsCount && (
                    <span className="text-gray-500 dark:text-gray-300">
                      ({book.ratingsCount.toLocaleString()} ratings)
                    </span>
                  )}
                </div>

                <p className="mb-6 leading-relaxed text-gray-700 dark:text-gray-300">
                  {book.description || "No description available"}
                </p>

                <div className="flex flex-wrap gap-3">
                  {[
                    {
                      icon: () => <Fragment>BookOpen</Fragment>,
                      label: "Have Read",
                      id: BookStatus.FINISHED,
                    } as const,
                    {
                      icon: () => <Fragment>BookOpen</Fragment>,
                      label: "Currently Reading",
                      id: BookStatus.READING,
                    } as const,
                    {
                      icon: () => <Fragment>Library</Fragment>,
                      label: "Want to Read",
                      id: BookStatus.WANTTOREAD,
                    } as const,
                    {
                      icon: () => <Fragment>BookX</Fragment>,
                      label: "Abandoned",
                      id: BookStatus.ABANDONED,
                    } as const,
                  ].map((shelf) => {
                    // const Icon = shelf.icon;
                    // const isSelected = selectedShelf === shelf.id;
                    return (
                      <BookForm book={book} status={shelf.id}>
                        <button
                          key={shelf.id}
                          // onClick={() => setSelectedShelf(shelf.id)}
                          className={`focus-visible:outline-indigo-600" flex cursor-pointer justify-center rounded-md px-3 py-1.5 text-sm/6 font-semibold shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                            usersBook
                              ? usersBook.status === shelf.id
                                ? "bg-green-600 text-white hover:bg-green-500"
                                : "bg-indigo-950 text-slate-600 hover:bg-indigo-800 hover:text-white"
                              : "border border-indigo-600 text-white hover:bg-indigo-500"
                          }`}
                        >
                          {/* <Icon class="h-5 w-5" /> */}
                          {shelf.label}
                        </button>
                      </BookForm>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Recommendations */}
          <aside className="lg:w-1/4">
            <Recommendations book={book} did={did} />
          </aside>
        </div>
      </div>
    </Fragment>
  );
};
