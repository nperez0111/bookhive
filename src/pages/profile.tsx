/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";
import { type HiveBook, type UserBook } from "../db";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";

export const ProfilePage: FC<{
  handle: string;
  books: (UserBook & HiveBook)[];
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
        <section>
          <h2 class="mb-6 text-2xl font-semibold">Books</h2>
          <BookList books={books} />
        </section>
      ) : (
        <div class="text-center">😔 This user has no books on bookhive</div>
      )}
    </div>
  );
};
