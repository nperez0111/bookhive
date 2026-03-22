import type { FC } from "hono/jsx";
import type { Book, ProfileViewDetailed } from "../types";
import { BuzzSection } from "./components/buzz";

export interface FeedPageProps {
  activities: Book[];
  currentTab: "friends" | "all" | "tracking";
  currentPage: number;
  hasMore: boolean;
  profileByDid: Record<string, ProfileViewDetailed>;
  didHandleMap: Record<string, string>;
  currentUserHandle?: string;
}

const TAB_LABELS: Record<"friends" | "all" | "tracking", string> = {
  friends: "Friends",
  all: "All",
  tracking: "Books I Track",
};

const TAB_EMPTY: Record<"friends" | "all" | "tracking", string> = {
  friends: "Follow users to see their activity",
  all: "Check back later",
  tracking: "Add books to your library to see activity on books you track",
};

export const FeedPage: FC<FeedPageProps> = ({
  activities,
  currentTab,
  currentPage,
  hasMore,
  profileByDid,
  didHandleMap,
  currentUserHandle,
}) => {
  const profileMap = Object.fromEntries(
    Object.entries(profileByDid).map(([did, p]) => [did, { avatar: p.avatar }]),
  );

  return (
    <div class="space-y-6 px-4 py-8 lg:px-8">
      <div class="flex items-center justify-between">
        <h1 class="text-foreground text-3xl font-bold tracking-tight">Activity Feed</h1>
        {currentUserHandle && currentTab === "friends" && (
          <a
            href={`/rss/friends/${currentUserHandle}`}
            title="RSS feed for friends' activity"
            class="btn btn-ghost flex items-center gap-1.5"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              class="h-4 w-4 text-orange-500"
            >
              <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z" />
            </svg>
            RSS
          </a>
        )}
      </div>

      {/* Tabs: link-based, no JS */}
      <div class="flex gap-2 border-b border-border">
        {(["friends", "all", "tracking"] as const).map((t) => (
          <a
            href={`/feed?tab=${t}`}
            class={`tab-label cursor-pointer px-3 py-2 text-sm font-medium ${
              currentTab === t
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </a>
        ))}
      </div>

      {activities.length === 0 ? (
        <div class="empty">
          <div class="empty-title">No activity yet</div>
          <div class="empty-description">{TAB_EMPTY[currentTab]}</div>
        </div>
      ) : (
        <BuzzSection
          title=""
          subtitle=""
          books={activities}
          didHandleMap={didHandleMap}
          profileMap={profileMap}
          showDetails
        />
      )}

      {hasMore && (
        <div class="text-center">
          <a href={`/feed?tab=${currentTab}&page=${currentPage + 1}`} class="btn btn-secondary">
            Load more
          </a>
        </div>
      )}
    </div>
  );
};
