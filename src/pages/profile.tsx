import { type FC } from "hono/jsx";
import { type Book } from "../types";
import type { ProfileViewDetailed } from "../types";
import { BookList } from "./components/book";
import { ProfileHeader } from "./components/ProfileHeader";
import { BookReview } from "./components/BookReview";
import { EditableLibraryTable } from "./components/EditableLibraryTable";

export const ProfilePage: FC<{
  handle: string;
  did: string;
  books: Book[];
  isBuzzer: boolean;
  profile: ProfileViewDetailed | null;
  isFollowing?: boolean;
  canFollow?: boolean;
  isOwnProfile?: boolean;
}> = ({
  handle,
  did,
  profile,
  books,
  isBuzzer,
  isFollowing,
  canFollow,
  isOwnProfile,
}) => {
  return (
    <div class="bg-sand container mx-auto min-h-[calc(100vh-64px)] max-w-7xl p-8 px-3 dark:bg-zinc-900 dark:text-white">
      <ProfileHeader
        handle={handle}
        did={did}
        isFollowing={isFollowing}
        canFollow={canFollow}
        profile={profile}
        books={books}
      />

      <div class="flex flex-col gap-10">
        {isBuzzer ? (
          <>
            <section class="mt-8 flex flex-col gap-2 px-4 lg:px-8">
              <div class="mb-6">
                <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
                  Library
                </h2>
              </div>
              {isOwnProfile ? (
                <EditableLibraryTable
                  books={books}
                  redirectUrl={`/profile/${handle}`}
                />
              ) : (
                <BookList books={books} />
              )}
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
