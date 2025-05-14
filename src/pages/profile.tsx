import { type FC } from "hono/jsx";
import { type Book } from "../types";
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
    <div class="bg-sand container mx-auto min-h-[calc(100vh-64px)] max-w-7xl p-8 px-3 dark:bg-zinc-900 dark:text-white">
      <div class="mb-12 flex items-start gap-8 px-4">
        {profile?.avatar && (
          <img
            class="size-32 rounded-xl object-cover shadow-lg transition sm:size-40 md:size-56"
            src={`/images/w_500/${profile.avatar}`}
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
          <div class="px-4 lg:px-8">
            To export your Goodreads library,{" "}
            <a
              href="https://www.goodreads.com/review/import"
              class="inline text-blue-800 hover:underline"
              target="_blank"
            >
              export your library
            </a>{" "}
            and then you can import it here:
            <label
              class="ml-3 inline-block cursor-pointer rounded-md bg-yellow-50 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              role="menuitem"
              tabindex={-1}
              id="user-menu-item-2"
            >
              <span id="import-label">Import Goodreads CSV</span>
              <span id="importing-label" class="hidden">
                Importing...
                <svg
                  class="ml-2 inline-block h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                    fill="none"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </span>
              <input
                type="file"
                name="export"
                accept=".csv"
                class="hidden"
                onchange={`
                const form = new FormData();
                form.append('export', this.files[0]);
                document.getElementById('import-label').classList.add('hidden');
                document.getElementById('importing-label').classList.remove('hidden');
                fetch('/import/goodreads', {
                  method: 'POST',
                  body: form
                }).then(() => {
                  window.location.reload();
                });
              `}
              />
            </label>
          </div>
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
                    <div class="group mb-2 cursor-pointer rounded-lg border border-slate-200 bg-yellow-50 p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-zinc-800">
                      <a href={`/books/${book.hiveId}`} class="flex gap-4">
                        {book.cover || book.thumbnail ? (
                          <img
                            src={`${book.cover || book.thumbnail || ""}`}
                            // src={`/images/w_300/${book.cover || book.thumbnail || ""}`}
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
