import { type FC } from "hono/jsx";
import type { ProfileViewDetailed } from "../../types";
import { formatDistanceToNow } from "date-fns";
import type { Book } from "../../types";
import { BOOK_STATUS } from "../../constants";
import { avatarImageUrl } from "../../core/imageUrl";
import { ShareMenu } from "./ShareMenu";

export const ProfileHeader: FC<{
  handle: string;
  did: string;
  profile: ProfileViewDetailed | null;
  books: Book[];
  isFollowing?: boolean;
  canFollow?: boolean;
  isOwnProfile?: boolean;
  followingCount?: number;
  followersCount?: number;
}> = ({
  handle,
  did,
  profile,
  books,
  isFollowing,
  canFollow,
  isOwnProfile,
  followingCount = 0,
  followersCount = 0,
}) => {
  const booksRead = books.filter((b) => b.status === BOOK_STATUS.FINISHED).length;
  const reviewCount = books.filter((b) => b.review?.trim()).length;
  const joinDate =
    books.length > 0
      ? formatDistanceToNow(new Date(books.map((b) => b.createdAt).sort()[0]!), { addSuffix: true })
      : null;

  const bskyShareHref = `https://bsky.app/intent/compose?text=${encodeURIComponent(`Check out @${handle}'s reading profile on BookHive! https://bookhive.buzz/profile/${handle}`)}`;

  return (
    <div class="card">
      <div class="card-body flex flex-col items-start gap-4 md:flex-row md:items-start">
        {profile?.avatar && (
          <img
            src={avatarImageUrl(did, { size: 160 })}
            alt=""
            width="80"
            height="80"
            decoding="async"
            fetchpriority="high"
            /* Not `loading="lazy"`: this avatar is always above the fold, so deferring it just
               delays the page's visual anchor and flashes an empty circle first. */
            class="h-20 w-20 flex-shrink-0 rounded-full object-cover outline outline-1 outline-black/10 dark:outline-white/10"
          />
        )}
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-bold text-foreground">{profile?.displayName || handle}</h1>
          {!isOwnProfile && (
            <a
              href={`https://bsky.app/profile/${handle}`}
              class="text-muted-foreground hover:text-foreground mt-0.5 block text-sm"
            >
              @{handle}
            </a>
          )}
          {!isOwnProfile && profile?.description && (
            <p class="text-muted-foreground mt-2 leading-relaxed">{profile.description}</p>
          )}
          {!isOwnProfile && joinDate && (
            <p class="text-muted-foreground mt-1 text-sm">Joined {joinDate}</p>
          )}
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="badge">
              <span class="tabular-nums">{booksRead}</span> books read
            </span>
            <span class="badge">
              <span class="tabular-nums">{reviewCount}</span> reviews
            </span>
            {followingCount > 0 && (
              <a href="#social" class="badge hover:bg-muted transition-colors duration-150">
                <span class="tabular-nums">{followingCount}</span> following
              </a>
            )}
            {followersCount > 0 && (
              <a href="#social" class="badge hover:bg-muted transition-colors duration-150">
                <span class="tabular-nums">{followersCount}</span>{" "}
                {followersCount === 1 ? "follower" : "followers"}
              </a>
            )}
          </div>
        </div>
        <div class="flex flex-shrink-0 items-stretch gap-2">
          {/* Share dropdown */}
          <ShareMenu
            blueskyHref={bskyShareHref}
            copyPath={`/profile/${handle}`}
            rssPath={`/rss/user/${handle}`}
          />
          {isOwnProfile ? (
            <a href="/settings" class="btn btn-ghost min-h-10 items-center flex">
              Settings
            </a>
          ) : (
            <>
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
