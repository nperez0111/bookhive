import { type FC } from "hono/jsx";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { formatDistanceToNow } from "date-fns";
import type { Book } from "../../types";

export const ProfileHeader: FC<{
  handle: string;
  profile: ProfileViewDetailed | null;
  books: Book[];
}> = ({ handle, profile, books }) => {
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
  );
};
