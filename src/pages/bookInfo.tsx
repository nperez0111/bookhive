/** @jsx createElement */
// @ts-ignore
import { type FC, createElement, Fragment } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { formatDistanceToNow } from "date-fns";
import { Navbar } from "./navbar";
import * as Profile from "../bsky/lexicon/types/app/bsky/actor/profile";
import type { BookResult } from "../scrapers";

async function Recommendations({ book }: { book: BookResult }) {
  const c = useRequestContext();
  const relatedBooks = await c
    .get("ctx")
    .db.selectFrom("book")
    .selectAll()
    .where("book.hiveId", "==", book.id)
    .limit(10)
    .execute();

  const didHandleMap = await c
    .get("ctx")
    .resolver.resolveDidsToHandles(relatedBooks.map((s) => s.authorDid));

  return (
    <Fragment>
      <h3 class="mt-5 mb-5 text-xl leading-2">
        Who else is reading this book?
      </h3>
      {relatedBooks.map((related) => {
        const handle = didHandleMap[related.authorDid] || related.authorDid;
        return (
          <div key={related.authorDid}>
            <a
              class="text-blue-600"
              href={`https://bsky.app/profile/${handle}`}
            >
              @{handle}
            </a>{" "}
            - {related.status} {formatDistanceToNow(related.createdAt)} ago
          </div>
        );
      })}
    </Fragment>
  );
}

export const BookInfo: FC<{
  profile?: Profile.Record;
  profileAvatar?: string;
  book: BookResult;
}> = ({ profile, profileAvatar, book }) => {
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
            <div className="mb-8 flex flex-col gap-8 rounded-xl bg-white p-6 shadow-md md:flex-row">
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

                <form action="/books" method="post" class="mt-4">
                  {/* author, title, year, status, isbn, hiveId, coverImage */}
                  <input
                    type="hidden"
                    name="author"
                    value={book.authors.join(", ")}
                  />
                  <input type="hidden" name="title" value={book.title} />
                  {book.publishedDate && (
                    <input
                      type="hidden"
                      name="year"
                      value={new Date(book.publishedDate).getFullYear()}
                    />
                  )}
                  <input type="hidden" name="status" value="reading" />
                  <input
                    type="hidden"
                    name="isbn"
                    value={book.identifiers.goodreads}
                  />
                  <input type="hidden" name="hiveId" value={book.id} />
                  <input type="hidden" name="coverImage" value={book.cover} />
                  <button
                    type="submit"
                    class="flex w-full cursor-pointer justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  >
                    Add to my hive
                  </button>
                </form>
                <div className="mt-4 flex items-center justify-between">
                  <button className="rounded-full bg-indigo-800 p-2 hover:bg-gray-100">
                    Share
                    {/* <Share2 className="h-5 w-5 text-gray-600" /> */}
                  </button>
                  <button className="rounded-full bg-indigo-800 p-2 hover:bg-gray-100">
                    Heart
                    {/* <Heart className="h-5 w-5 text-gray-600" /> */}
                  </button>
                  <button className="rounded-full bg-indigo-800 p-2 hover:bg-gray-100">
                    ...
                    {/* <MoreHorizontal className="h-5 w-5 text-gray-600" /> */}
                  </button>
                </div>
              </div>

              <div className="flex-1">
                <h1 className="mb-2 text-3xl font-bold text-gray-900">
                  {book.title}
                </h1>
                <p className="mb-4 text-xl text-gray-600">
                  by {book.authors.join(", ")}
                </p>

                <div className="mb-6 flex items-center gap-1">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((star) => (
                      // <Star
                      //   key={star}
                      //   className="h-5 w-5 fill-amber-400 text-amber-400"
                      // />
                      <svg
                        class="relative inline-flex w-8"
                        viewBox="0 0 23 23"
                        key={star}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            class="fill-current text-transparent"
                          ></circle>
                          <path
                            class="fill-current text-yellow-300"
                            d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
                          ></path>
                        </svg>
                      </svg>
                    ))}
                  </div>
                  {book.rating && (
                    <span className="text-lg font-semibold">{book.rating}</span>
                  )}
                  {book.ratingsCount && (
                    <span className="text-gray-500">
                      ({book.ratingsCount} ratings)
                    </span>
                  )}
                </div>

                <p className="mb-6 leading-relaxed text-gray-700">
                  {book.description || "No description available"}
                </p>

                <div className="flex flex-wrap gap-3">
                  {[
                    {
                      icon: () => <Fragment>BookOpen</Fragment>,
                      label: "Currently Reading",
                      id: "reading",
                    },
                    {
                      icon: () => <Fragment>Library</Fragment>,
                      label: "Want to Read",
                      id: "want",
                    },
                    {
                      icon: () => <Fragment>BookX</Fragment>,
                      label: "Stopped Reading",
                      id: "stopped",
                    },
                  ].map((shelf) => {
                    // const Icon = shelf.icon;
                    // const isSelected = selectedShelf === shelf.id;
                    return (
                      <button
                        key={shelf.id}
                        // onClick={() => setSelectedShelf(shelf.id)}
                        className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                          /*isSelected*/ true
                            ? "bg-amber-600 text-white"
                            : "bg-amber-50 text-amber-800 hover:bg-amber-100"
                        }`}
                      >
                        {/* <Icon class="h-5 w-5" /> */}
                        {shelf.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Recommendations */}
          <aside className="lg:w-1/4">
            <Recommendations book={book} />
          </aside>
        </div>
      </div>
    </Fragment>
  );
};
