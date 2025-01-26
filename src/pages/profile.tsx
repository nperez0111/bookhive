import { type FC } from "hono/jsx";
import { type Book } from "../db";

import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";
import { formatDistanceToNow } from "date-fns";
import { FallbackCover } from "./components/fallbackCover";

export const ProfilePage: FC<{
  handle: string;
  books: Book[];
  isBuzzer: boolean;
  profile: ProfileViewDetailed | null;
}> = ({ handle, profile, books, isBuzzer }) => {
  return (
    <div class="container mx-auto min-h-[calc(100vh-64px)] max-w-7xl bg-slate-50 p-8 px-3 dark:bg-slate-900 dark:text-white">
      <div class="mb-12 flex items-start gap-8 px-4">
        {profile?.avatar && (
          <img
            class="size-32 rounded-xl object-cover shadow-lg transition sm:size-40 md:size-56"
            src={profile.avatar}
            alt=""
          />
        )}
        <div class="flex flex-col gap-4">
          <h1 class="text-5xl leading-12 font-bold lg:text-6xl lg:tracking-tight">
            {profile?.displayName || handle}
          </h1>
          <p class="text-lg text-slate-600 dark:text-slate-400">
            <a
              href={`https://bsky.app/profile/${handle}`}
              class="inline text-blue-600 hover:underline"
            >
              @{handle} 🦋
            </a>
            {books.length
              ? ` • Joined ${formatDistanceToNow(books.map((book) => book.createdAt).sort()[0], { addSuffix: true })}`
              : null}
          </p>
          {profile?.description && (
            <p class="max-w-2xl leading-relaxed text-slate-600 dark:text-slate-300">
              {profile.description}
            </p>
          )}
        </div>
      </div>

      {isBuzzer ? (
        <div class="flex flex-col gap-10">
          <section class="mt-8 flex flex-col gap-2 px-4 lg:px-8">
            <div class="mb-6">
              <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
                Library
              </h2>
            </div>
            <BookList books={books} />
          </section>
          {books.some((book) => book.review) && (
            <section class="mt-16 flex flex-col gap-2 px-4 lg:px-8">
              <div class="mb-6">
                <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
                  Reviews
                </h2>
              </div>
              {books
                .filter((book) => book.review)
                .map((book) => {
                  return (
                    <div class="group mb-2 cursor-pointer rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
                      <a href={`/books/${book.hiveId}`} class="flex gap-4">
                        {book.cover || book.thumbnail ? (
                          <img
                            src={book.cover || book.thumbnail || ""}
                            alt=""
                            class="h-36 w-24 rounded-lg object-cover shadow-sm"
                          />
                        ) : (
                          <FallbackCover className="h-36 w-24" />
                        )}
                        <span class="flex flex-col gap-1">
                          <span class="text-lg font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400">
                            {book.title}
                          </span>
                          <span class="text-sm text-slate-600 dark:text-slate-400">
                            by {book.authors.split("\t").join(", ")}
                            {book.stars ? (
                              <span class="text-md mx-1 text-slate-800 dark:text-slate-200">
                                ({book.stars / 2} ⭐)
                              </span>
                            ) : null}
                          </span>
                          <p class="py-2">{book.review}</p>
                        </span>
                      </a>
                    </div>
                  );
                })}
            </section>
          )}
        </div>
      ) : (
        <div class="text-center">😔 This user has no books on bookhive</div>
      )}
    </div>
  );
};
