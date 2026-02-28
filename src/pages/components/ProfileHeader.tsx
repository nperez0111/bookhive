import { type FC } from "hono/jsx";
import type { ProfileViewDetailed } from "../../types";
import { formatDistanceToNow } from "date-fns";
import type { Book } from "../../types";
import { BOOK_STATUS } from "../../constants";

export const ProfileHeader: FC<{
  handle: string;
  did: string;
  profile: ProfileViewDetailed | null;
  books: Book[];
  isFollowing?: boolean;
  canFollow?: boolean;
  isOwnProfile?: boolean;
}> = ({
  handle,
  did,
  profile,
  books,
  isFollowing,
  canFollow,
  isOwnProfile,
}) => {
  const booksRead = books.filter((b) => b.status === BOOK_STATUS.FINISHED)
    .length;
  const reviewCount = books.filter((b) => b.review?.trim()).length;
  const joinDate =
    books.length > 0
      ? formatDistanceToNow(
          new Date(books.map((b) => b.createdAt).sort()[0]!),
          { addSuffix: true },
        )
      : null;

  return (
    <div class="card">
      <div class="card-body flex flex-col items-start gap-4 md:flex-row md:items-start">
        {profile?.avatar && (
          <img
            src={`/images/w_500/${profile.avatar}`}
            alt=""
            class="h-20 w-20 flex-shrink-0 rounded-full object-cover"
          />
        )}
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-bold text-foreground">
            {profile?.displayName || handle}
          </h1>
          <a
            href={`https://bsky.app/profile/${handle}`}
            class="text-muted-foreground hover:text-foreground mt-0.5 block text-sm"
          >
            @{handle}
          </a>
          {profile?.description && (
            <p class="text-muted-foreground mt-2 leading-relaxed">
              {profile.description}
            </p>
          )}
          {joinDate && (
            <p class="text-muted-foreground mt-1 text-sm">Joined {joinDate}</p>
          )}
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="badge">{booksRead} books read</span>
            <span class="badge">{reviewCount} reviews</span>
          </div>
        </div>
        <div class="flex flex-shrink-0 gap-2">
          {isOwnProfile ? (
            <a href="/settings" class="btn btn-ghost">
              Settings
            </a>
          ) : (
            <>
              <a
                href={`https://bsky.app/intent/compose?text=${encodeURIComponent(`Check out @${handle}'s reading profile on BookHive! https://bookhive.buzz/profile/${handle}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-ghost"
              >
                Share
              </a>
              {canFollow &&
                (isFollowing ? (
                  <form action="/api/unfollow-form" method="post">
                    <input type="hidden" name="did" value={did} />
                    <button type="submit" class="btn btn-ghost">
                      Following
                    </button>
                  </form>
                ) : (
                  <form action="/api/follow-form" method="post">
                    <input type="hidden" name="did" value={did} />
                    <button type="submit" class="btn btn-primary">
                      Follow
                    </button>
                  </form>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
