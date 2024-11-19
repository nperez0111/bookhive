/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement, Fragment } from "hono/jsx";
import { type Buzz, type Book } from "../db";
import * as Profile from "../bsky/lexicon/types/app/bsky/actor/profile";
// import { Chat } from "./chat";
import { Navbar } from "./navbar";
import { Script } from "./utils/script";
import type { BookResult } from "../scrapers";

function ts(status: Buzz) {
  const createdAt = new Date(status.createdAt);
  const indexedAt = new Date(status.indexedAt);
  if (createdAt < indexedAt) return createdAt.toDateString();
  return indexedAt.toDateString();
}

type Props = {
  latestBuzzes: Buzz[];
  didHandleMap: Record<string, string>;
  profile?: Profile.Record;
  profileAvatar?: string;
  myBooks?: Book[];
};

export const Home: FC<Props> = ({
  latestBuzzes,
  didHandleMap,
  profile,
  profileAvatar,
  myBooks,
}) => (
  <Fragment>
    <Navbar
      tab="home"
      profileAvatar={profileAvatar}
      hasProfile={Boolean(profile)}
    />

    <div class="container mx-auto h-[calc(100vh-64px)] max-w-7xl bg-slate-50 dark:bg-slate-900 dark:text-white">
      {profile && (
        <div>
          👋, <strong>{profile.displayName || "friend"}</strong>
        </div>
      )}
      {!profile && (
        <div class="flex justify-center">
          <h1 class="mb-2 mt-3 text-xl">👋, Welcome to the Book Hive 🐝!</h1>
        </div>
      )}
      <input
        type="text"
        placeholder="Search for books"
        id="search-books"
        class="dark:text-slate-900"
      />
      <div id="search-results"></div>
      <Script
        script={(document) => {
          const search = document.getElementById("search-books")!;
          const searchResults = document.getElementById("search-results")!;
          // debounce function
          function debounce(func: (...args: any[]) => void, wait: number) {
            let timeout: ReturnType<typeof setTimeout> | null = null;

            return (...args: any[]) => {
              if (timeout) {
                clearTimeout(timeout);
              }
              timeout = setTimeout(() => {
                func(...args);
              }, wait);
            };
          }

          const searchBooks = debounce(async (query) => {
            const res = await fetch(`/search-books?q=${query}`);
            const data: BookResult[] = await res.json();
            searchResults.innerHTML = "";
            data.forEach((book) => {
              const div = document.createElement("div");
              div.innerHTML = `
                <div class="flex items-center gap-2">
                  <img src="${book.cover}" class="h-16 w-16" />
                  <div>
                    <h2>${book.title}</h2>
                    <p>${book.authors.join(", ")}</p>
                  </div>
                </div>
              `;
              searchResults.appendChild(div);
            });
          }, 400);

          search.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value;
            searchBooks(query);
          });
        }}
      />
      {/* <Chat /> */}
      {profile && (
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
                    class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6 dark:bg-slate-800 dark:text-gray-50 dark:ring-gray-700"
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
                    class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6 dark:bg-slate-800 dark:text-gray-50 dark:ring-gray-700"
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
                      class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6 dark:bg-slate-800 dark:text-gray-50 dark:ring-gray-700"
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
              class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Save
            </button>
          </div>
        </form>
      )}
      {myBooks && (
        <div>
          <h2 class="text-md mb-6 mt-3 border-b">Your books</h2>
          <div class="flex flex-col gap-2">
            {myBooks.map((book) => {
              return (
                <a
                  href={`/books/${book.uri}`}
                  class="rounded-md bg-gray-100 px-3 py-1 hover:bg-gray-200 dark:bg-gray-800"
                >
                  <div>
                    {book.title} by {book.author}
                  </div>
                </a>
              );
            })}
          </div>
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
  </Fragment>
);
