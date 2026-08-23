import type { FC } from "hono/jsx";

import type { ProfileViewDetailed } from "../types";
import {
  type FeedGroup,
  type FeedTab,
  FEED_TABS,
  TAB_EMPTY,
  TAB_LABELS,
} from "../utils/activityFeed";
import { ActivityTimeline } from "./components/activityTimeline";
import { Script } from "./utils/script";

export interface FeedPageProps {
  groups: FeedGroup[];
  currentTab: FeedTab;
  nextCursor: string | null;
  profileByDid: Record<string, ProfileViewDetailed>;
  didHandleMap: Record<string, string>;
  currentUserHandle?: string;
}

export const FeedPage: FC<FeedPageProps> = ({
  groups,
  currentTab,
  nextCursor,
  profileByDid,
  didHandleMap,
  currentUserHandle,
}) => {
  return (
    <div class="space-y-6 px-4 py-8 lg:px-8">
      <div class="flex items-center justify-between">
        <h1 class="text-foreground text-3xl font-bold tracking-tight">Activity Feed</h1>
        {currentUserHandle && currentTab === "friends" && (
          <a
            href={`/rss/friends/${currentUserHandle}`}
            title="RSS feed for friends' activity"
            class="btn btn-ghost flex min-h-10 min-w-10 items-center justify-center gap-1.5"
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
      <div class="border-border flex gap-2 border-b">
        {FEED_TABS.map((t) => (
          <a
            href={`/feed?tab=${t}`}
            aria-current={currentTab === t ? "page" : undefined}
            class={`tab-label focus-ring flex min-h-10 cursor-pointer items-center px-3 py-2 text-sm font-medium transition-[color,border-color] duration-150 active:scale-[0.96] ${
              currentTab === t
                ? "border-primary text-foreground border-b-2"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </a>
        ))}
      </div>

      {groups.length === 0 ? (
        <div class="empty">
          <div class="empty-title">No activity yet</div>
          <div class="empty-description">{TAB_EMPTY[currentTab]}</div>
        </div>
      ) : (
        <ActivityTimeline groups={groups} didHandleMap={didHandleMap} profileByDid={profileByDid} />
      )}

      {nextCursor && (
        <div class="text-center">
          <a
            href={`/feed?tab=${currentTab}&cursor=${encodeURIComponent(nextCursor)}`}
            class="btn btn-secondary min-h-10 tabular-nums"
          >
            Load more
          </a>
        </div>
      )}

      {/*
        Relabel the newest date separators to Today/Yesterday, but only when the
        server's UTC bucket matches the viewer's local date. The server has no
        timezone for the viewer, so it renders real dates; this upgrades them
        rather than correcting them, and with JS off the dates stand on their own.
      */}
      <Script
        script={(document) => {
          const localKey = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
              d.getDate(),
            ).padStart(2, "0")}`;
          const now = new Date();
          const today = localKey(now);
          const yesterday = localKey(new Date(now.getTime() - 86400000));
          document.querySelectorAll("[data-feed-day]").forEach((el) => {
            const day = el.getAttribute("data-feed-day");
            const label = el.querySelector("time");
            if (!label) return;
            if (day === today) label.textContent = "Today";
            else if (day === yesterday) label.textContent = "Yesterday";
          });
        }}
      />
    </div>
  );
};
