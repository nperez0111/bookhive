/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";
import { type Buzz, type HiveBook, type UserBook } from "../db";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";

export const ProfilePage: FC<{
  handle: string;
  books: (UserBook & HiveBook)[];
  buzzes: Buzz[];
  isBuzzer: boolean;
  profile: ProfileViewDetailed | null;
}> = ({ handle, profile, books, buzzes, isBuzzer }) => {
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
          <h1 class="text-3xl font-bold md:text-4xl">
            {profile?.displayName || handle}
          </h1>
          {profile?.description && (
            <p class="max-w-2xl text-slate-600 dark:text-slate-300">
              {profile.description}
            </p>
          )}
        </div>
      </div>

      {isBuzzer ? (
        <div class="grid gap-12 md:grid-cols-2">
          <section>
            <h2 class="mb-6 text-2xl font-semibold">Books</h2>
            <ul class="space-y-4">
              {books.map((book) => (
                <li class="group cursor-pointer rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
                  <a href={`/books/${book.hiveId}`} class="flex flex-col gap-1">
                    <span class="text-lg font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400">
                      {book.title}
                    </span>
                    <span class="text-sm text-slate-600 dark:text-slate-400">
                      by {JSON.parse(book.authors).join(", ")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 class="mb-6 text-2xl font-semibold">Buzzes</h2>
            <ul class="space-y-4">
              {buzzes.map((buzz) => (
                <li class="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
                  <a
                    href={buzz.uri}
                    class="block text-slate-800 group-hover:text-sky-600 dark:text-slate-200 dark:group-hover:text-sky-400"
                  >
                    {buzz.bookUri}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <div class="text-center">😔 This user has no books on bookhive</div>
      )}
    </div>
  );
};
