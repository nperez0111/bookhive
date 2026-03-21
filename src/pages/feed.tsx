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
}) => {
  const profileMap = Object.fromEntries(
    Object.entries(profileByDid).map(([did, p]) => [did, { avatar: p.avatar }]),
  );

  return (
    <div class="space-y-6 px-4 py-8 lg:px-8">
      <div>
        <h1 class="text-foreground text-3xl font-bold tracking-tight">Activity Feed</h1>
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
