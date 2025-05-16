import { type FC } from "hono/jsx";
import { type Book } from "../types";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";
import { ProfileHeader } from "./components/ProfileHeader";
import { GoodreadsImport } from "./components/GoodreadsImport";
import { BookReview } from "./components/BookReview";

export const ProfilePage: FC<{
  handle: string;
  books: Book[];
  isBuzzer: boolean;
  profile: ProfileViewDetailed | null;
  isOwner: boolean;
}> = ({ handle, profile, books, isBuzzer, isOwner }) => {
  return (
    <div class="bg-sand container mx-auto min-h-[calc(100vh-64px)] max-w-7xl p-8 px-3 dark:bg-zinc-900 dark:text-white">
      <ProfileHeader handle={handle} profile={profile} books={books} />

      <div class="flex flex-col gap-10">
        {isOwner && <GoodreadsImport />}

        {isBuzzer ? (
          <>
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
                  .map((book) => (
                    <BookReview key={book.hiveId} book={book} />
                  ))}
              </section>
            )}
          </>
        ) : (
          <div class="text-center">😔 This user has no books on bookhive</div>
        )}
      </div>
    </div>
  );
};
