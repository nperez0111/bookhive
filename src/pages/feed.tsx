import type { FC } from "hono/jsx";
import { formatDistanceToNow } from "date-fns";
import { ActivityCard } from "./components/ActivityCard";
import type { FeedActivity } from "./components/ActivityCard";
import type { ProfileViewDetailed } from "../types";

type FeedRow = {
  uri: string;
  userDid: string;
  hiveId: string;
  title: string;
  authors: string;
  status: string | null;
  stars: number | null;
  review: string | null;
  createdAt: string;
  cover: string | null;
  thumbnail: string | null;
};

export interface FeedPageProps {
  activities: FeedRow[];
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

export const FeedPage: FC<FeedPageProps> = ({
  activities,
  currentTab,
  currentPage,
  hasMore,
  profileByDid,
  didHandleMap,
}) => {
  return (
    <div class="space-y-6 px-4 py-8 lg:px-8">
      <div>
        <h1 class="text-foreground text-3xl font-bold tracking-tight">
          Activity Feed
        </h1>
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
          <div class="empty-description">
            {currentTab === "friends"
              ? "Follow users to see their activity"
              : currentTab === "tracking"
                ? "Add books to your library to see activity on books you track"
                : "Check back later"}
          </div>
        </div>
      ) : (
        <div class="space-y-4">
          {activities.map((activity) => {
            const handle = didHandleMap[activity.userDid] ?? activity.userDid;
            const prof = profileByDid[activity.userDid];
            const user = {
              handle,
              displayName: prof?.displayName ?? null,
              avatar: prof?.avatar ?? null,
            };
            const feedActivity: FeedActivity = {
              uri: activity.uri,
              userDid: activity.userDid,
              hiveId: activity.hiveId,
              title: activity.title,
              authors: activity.authors,
              status: activity.status,
              stars: activity.stars,
              review: activity.review,
              createdAt: activity.createdAt,
              cover: activity.cover,
              thumbnail: activity.thumbnail,
            };
            const timeAgo = formatDistanceToNow(new Date(activity.createdAt), {
              addSuffix: true,
            });
            return (
              <ActivityCard
                key={`${activity.userDid}-${activity.hiveId}-${activity.createdAt}`}
                activity={feedActivity}
                user={user}
                timeAgo={timeAgo}
              />
            );
          })}
        </div>
      )}

      {hasMore && (
        <div class="text-center">
          <a
            href={`/feed?tab=${currentTab}&page=${currentPage + 1}`}
            class="btn btn-secondary"
          >
            Load more
          </a>
        </div>
      )}
    </div>
  );
};
