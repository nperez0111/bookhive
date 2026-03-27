import { type FC } from "hono/jsx";
import type { ProfileViewDetailed } from "../../types";
import { formatDistanceToNow } from "date-fns";
import type { Book } from "../../types";
import { BOOK_STATUS } from "../../constants";
import { Script } from "../utils/script";

export const ProfileHeader: FC<{
  handle: string;
  did: string;
  profile: ProfileViewDetailed | null;
  books: Book[];
  isFollowing?: boolean;
  canFollow?: boolean;
  isOwnProfile?: boolean;
}> = ({ handle, did, profile, books, isFollowing, canFollow, isOwnProfile }) => {
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
            src={`/images/w_500/${profile.avatar}`}
            alt=""
            loading="lazy"
            class="h-20 w-20 flex-shrink-0 rounded-full object-cover"
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
            <span class="badge">{booksRead} books read</span>
            <span class="badge">{reviewCount} reviews</span>
          </div>
        </div>
        <div class="flex flex-shrink-0 gap-2">
          {/* Share dropdown */}
          <div class="relative">
            <button
              type="button"
              id="profile-share-btn"
              class="btn btn-ghost"
              aria-haspopup="true"
              aria-expanded="false"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Share
            </button>
            <div
              id="profile-share-menu"
              class="invisible absolute right-0 z-10 mt-1 w-48 rounded-lg bg-card opacity-0 shadow-lg ring-1 ring-border transition-all duration-100 ease-in-out"
            >
              <div class="p-1">
                <a
                  href={bskyShareHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <svg viewBox="0 0 24 24" class="h-4 w-4 fill-current" aria-hidden="true">
                    <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
                  </svg>
                  Share on Bluesky
                </a>
                <button
                  type="button"
                  id="profile-copy-link-btn"
                  class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                  data-profile-url={`/profile/${handle}`}
                >
                  <svg
                    class="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  <span id="profile-copy-link-text">Copy link</span>
                </button>
                <button
                  type="button"
                  id="profile-copy-rss-btn"
                  class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                  data-rss-url={`/rss/user/${handle}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    class="h-4 w-4 text-orange-500"
                  >
                    <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z" />
                  </svg>
                  <span id="profile-copy-rss-text">Copy RSS feed</span>
                </button>
              </div>
            </div>
            <Script
              script={(document) => {
                const btn = document.getElementById("profile-share-btn")!;
                const menu = document.getElementById("profile-share-menu")!;
                btn.addEventListener("click", () => {
                  const open = menu.classList.contains("invisible");
                  menu.classList.toggle("invisible", !open);
                  menu.classList.toggle("opacity-0", !open);
                  btn.setAttribute("aria-expanded", open ? "true" : "false");
                });
                document.addEventListener("click", (e) => {
                  if (!btn.contains(e.target as any) && !menu.contains(e.target as any)) {
                    menu.classList.add("invisible", "opacity-0");
                    btn.setAttribute("aria-expanded", "false");
                  }
                });
                const copyBtn = document.getElementById("profile-copy-link-btn");
                const copyText = document.getElementById("profile-copy-link-text");
                if (copyBtn && copyText) {
                  copyBtn.addEventListener("click", () => {
                    const url = copyBtn.getAttribute("data-profile-url");
                    if (url) {
                      void navigator.clipboard.writeText((window.location.origin || "") + url);
                      copyText.textContent = "Copied!";
                      setTimeout(() => {
                        copyText.textContent = "Copy link";
                      }, 1500);
                    }
                  });
                }
                const rssBtn = document.getElementById("profile-copy-rss-btn");
                const rssText = document.getElementById("profile-copy-rss-text");
                if (rssBtn && rssText) {
                  rssBtn.addEventListener("click", () => {
                    const url = rssBtn.getAttribute("data-rss-url");
                    if (url) {
                      void navigator.clipboard.writeText((window.location.origin || "") + url);
                      rssText.textContent = "Copied!";
                      setTimeout(() => {
                        rssText.textContent = "Copy RSS feed";
                      }, 1500);
                    }
                  });
                }
              }}
            />
          </div>
          {isOwnProfile ? (
            <a href="/settings" class="btn btn-ghost">
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
