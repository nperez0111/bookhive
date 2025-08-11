import { type FC } from "hono/jsx";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { formatDistanceToNow } from "date-fns";
import type { Book } from "../../types";

export const ProfileHeader: FC<{
  handle: string;
  did: string;
  profile: ProfileViewDetailed | null;
  books: Book[];
  isFollowing?: boolean;
  canFollow?: boolean;
}> = ({ handle, did, profile, books, isFollowing, canFollow }) => {
  return (
    <div class="mb-12 flex items-start gap-8 px-4">
      {profile?.avatar && (
        <img
          class="size-32 rounded-xl object-cover shadow-lg transition sm:size-40 md:size-56"
          src={`/images/w_500/${profile.avatar}`}
          alt=""
        />
      )}
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <h1 class="text-5xl leading-12 font-bold lg:text-6xl lg:tracking-tight">
            {profile?.displayName || handle}
          </h1>
          {canFollow ? (
            isFollowing ? (
              <span class="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                Following
              </span>
            ) : (
              <form action="/api/follow-form" method="post">
                <input type="hidden" name="did" value={did} />
                <button
                  type="submit"
                  class="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  Follow
                </button>
              </form>
            )
          ) : null}
        </div>
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
  );
};
