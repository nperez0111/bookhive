/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement, Fragment } from "hono/jsx";
import { type Buzz, type HiveBook, type UserBook } from "../db";
// import { Chat } from "./chat";
import { Script } from "./utils/script";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";

function ts(status: Buzz) {
  const createdAt = new Date(status.createdAt);
  const indexedAt = new Date(status.indexedAt);
  if (createdAt < indexedAt) return createdAt.toDateString();
  return indexedAt.toDateString();
}

type Props = {
  latestBuzzes: Buzz[];
  didHandleMap: Record<string, string>;
  profile?: ProfileViewDetailed;
  myBooks?: (UserBook & HiveBook)[];
};

export const Home: FC<Props> = ({
  latestBuzzes,
  didHandleMap,
  profile,
  myBooks,
}) => (
  <div class="container mx-auto h-[calc(100vh-64px)] max-w-7xl bg-slate-50 px-3 dark:bg-slate-900 dark:text-white">
    <div class="flex justify-center">
      {profile ? (
        <h1 class="mt-3 mb-2 text-3xl">
          👋, <span class="font-bold">{profile.displayName || "friend"}</span>,
          welcome back to Book Hive 🐝!
        </h1>
      ) : (
        <h1 class="mt-3 mb-2 text-3xl">👋, Welcome to the Book Hive 🐝!</h1>
      )}
    </div>
    {/* <Chat /> */}
    {/* {profile && (
      <form action="/books" method="post">
        <div class="space-y-12">
          <div class="border-b border-gray-900/10 pb-12">
            <div class="sm:col-span-4">
              <label
                for="title"
                class="block text-sm/6 font-medium text-gray-900 dark:text-gray-50"
              >
                Title
              </label>
              <div class="mt-2">
                <input
                  id="title"
                  name="title"
                  type="text"
                  placeholder="Enter the title of the book"
                  class="block w-full rounded-md border-0 py-1.5 text-gray-900 ring-1 shadow-xs ring-gray-300 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-600 focus:ring-inset sm:text-sm/6 dark:bg-slate-800 dark:text-gray-50 dark:ring-gray-700 dark:placeholder:text-gray-800"
                />
              </div>
            </div>
            <div class="sm:col-span-4">
              <label
                for="author"
                class="block text-sm/6 font-medium text-gray-900 dark:text-gray-50"
              >
                Author
              </label>
              <div class="mt-2">
                <input
                  id="author"
                  name="author"
                  type="text"
                  placeholder="King, Stephen"
                  class="block w-full rounded-md border-0 py-1.5 text-gray-900 ring-1 shadow-xs ring-gray-300 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-600 focus:ring-inset sm:text-sm/6 dark:bg-slate-800 dark:text-gray-50 dark:ring-gray-700"
                />
              </div>
              <div class="sm:col-span-4">
                <label
                  for="year"
                  class="block text-sm/6 font-medium text-gray-900 dark:text-gray-50"
                >
                  Year Published
                </label>
                <div class="mt-2">
                  <input
                    id="year"
                    name="year"
                    type="number"
                    placeholder="2021"
                    class="block w-full rounded-md border-0 py-1.5 text-gray-900 ring-1 shadow-xs ring-gray-300 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-600 focus:ring-inset sm:text-sm/6 dark:bg-slate-800 dark:text-gray-50 dark:ring-gray-700"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 flex items-center justify-end gap-x-6">
          <button
            type="button"
            class="text-sm/6 font-semibold text-gray-900 dark:text-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Save
          </button>
        </div>
      </form>
    )} */}
    {myBooks && (
      <div>
        <h2 class="text-md mt-3 mb-6 border-b text-2xl leading-12">
          Your books
        </h2>
        {/* <div class="flex flex-col gap-2">
          {myBooks.map((book) => {
            return (
              <a
                href={`/books/${book.hiveId}`}
                class="flex cursor-pointer items-center justify-between rounded-md bg-gray-100 px-3 py-1 hover:bg-gray-700 dark:bg-gray-800"
              >
                <div>
                  {book.title} by {book.authors.split("\t").join(", ")}
                </div>
                <button
                  data-type="delete-book"
                  data-id={book.uri.split("/").pop()}
                  class="cursor-pointer rounded-md border border-red-500 px-3 py-1 text-xs text-red-500"
                >
                  Delete
                </button>
              </a>
            );
          })}
        </div> */}
        <ul class="space-y-4">
          {myBooks.map((book) => (
            <li class="group flex justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
              <a
                href={`/books/${book.hiveId}`}
                class="flex cursor-pointer flex-col gap-1"
              >
                <span class="text-lg font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400">
                  {book.title}
                </span>
                <span class="text-sm text-slate-600 dark:text-slate-400">
                  by {book.authors.split("\t").join(", ")}
                </span>
              </a>

              <button
                data-type="delete-book"
                data-id={book.uri.split("/").pop()}
                class="cursor-pointer rounded-md border border-red-500 px-3 py-1 text-xs text-red-500"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <Script
          script={(document) => {
            document
              .querySelectorAll("[data-type=delete-book]")
              .forEach((el) => {
                el.addEventListener("click", async (e) => {
                  e.preventDefault();
                  const id = el.getAttribute("data-id");
                  const res = await fetch(`/books/${id}`, {
                    method: "DELETE",
                  });
                  if (res.ok) {
                    const { success } = await res.json();
                    if (success) {
                      window.location.reload();
                    }
                  }
                });
              });
          }}
        ></Script>
      </div>
    )}
    {latestBuzzes.map((review) => {
      const handle = didHandleMap[review.authorDid] || review.authorDid;
      const date = ts(review);
      return (
        <div>
          <a class="author" href={`https://bsky.app/profile/${handle}`}>
            @${handle}
          </a>
          {JSON.stringify(review)} on {date}
        </div>
      );
    })}
  </div>
);
