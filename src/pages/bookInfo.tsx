/** @jsx createElement */
// @ts-ignore
import { type FC, createElement, Fragment } from "hono/jsx";
import { Navbar } from "./navbar";
import * as Profile from "../bsky/lexicon/types/app/bsky/actor/profile";
import type { BookResult } from "../scrapers";

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
              <div className="w-full md:w-1/3 lg:w-1/4">
                <img
                  src={book.cover || book.thumbnail}
                  alt={`Cover of ${book.title}`}
                  className="aspect-[2/3] w-full rounded-lg object-cover shadow-lg"
                />
                <div className="mt-4 flex items-center justify-between">
                  <button className="rounded-full p-2 hover:bg-gray-100">
                    Share
                    {/* <Share2 className="h-5 w-5 text-gray-600" /> */}
                  </button>
                  <button className="rounded-full p-2 hover:bg-gray-100">
                    Heart
                    {/* <Heart className="h-5 w-5 text-gray-600" /> */}
                  </button>
                  <button className="rounded-full p-2 hover:bg-gray-100">
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
                    const Icon = shelf.icon;
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
                        <Icon class="h-5 w-5" />
                        {shelf.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Recommendations */}
          <div className="lg:w-1/4">Sidebar</div>
        </div>
      </div>
    </Fragment>
  );
};
