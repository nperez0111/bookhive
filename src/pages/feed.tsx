import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import { BookFields } from "../db";
import type { Book } from "../types";
import type { ProfileViewDetailed } from "../types";
import { formatDistanceToNow } from "date-fns";
import { getProfiles } from "../utils/getProfile";

export const FeedPage: FC = async () => {
  const c = useRequestContext();
  const profile = await c.get("ctx").getProfile();
  if (!profile) {
    return null as any; // Route redirects unauthenticated users
  }

  startTime(c, "feedFriendsBuzzes");
  const friendsBuzzes = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .innerJoin("user_follows", "user_book.userDid", "user_follows.followsDid")
    .select(BookFields)
    .where("user_follows.userDid", "=", profile.did)
    .where("user_follows.isActive", "=", 1)
    .orderBy("user_book.createdAt", "desc")
    .limit(100)
    .execute();
  endTime(c, "feedFriendsBuzzes");

  startTime(c, "feedLatestBuzzes");
  const latestBuzzes = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .orderBy("user_book.createdAt", "desc")
    .limit(100)
    .execute();
  endTime(c, "feedLatestBuzzes");

  const allDids = [
    ...new Set([
      ...friendsBuzzes.map((b) => b.userDid),
      ...latestBuzzes.map((b) => b.userDid),
    ]),
  ];
  const [didHandleMap, friendProfiles] = await Promise.all([
    c.get("ctx").resolver.resolveDidsToHandles(allDids),
    allDids.length > 0
      ? getProfiles({ ctx: c.get("ctx"), dids: allDids })
      : [] as ProfileViewDetailed[],
  ]);
  const profileByDid = Object.fromEntries(
    friendProfiles.map((p) => [p.did, p]),
  );

  const combined = [
    ...(friendsBuzzes as Book[]).map((b) => ({ ...b, _source: "friends" as const })),
    ...(latestBuzzes as Book[]).map((b) => ({ ...b, _source: "all" as const })),
  ].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const seen = new Set<string>();
  const deduped = combined.filter((item) => {
    const key = `${item.userDid}-${item.hiveId}-${item.createdAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div class="space-y-8 px-4 py-8 lg:px-8">
      <h1 class="text-foreground text-2xl font-bold tracking-tight">
        Activity Feed
      </h1>

      <div class="card">
        <div class="card-body space-y-4">
          {deduped.length === 0 ? (
            <p class="text-muted-foreground">
              No activity yet. Follow people on BookHive or add books to see activity here.
            </p>
          ) : (
            deduped.slice(0, 50).map((activity) => {
              const handle = didHandleMap[activity.userDid] ?? activity.userDid;
              const prof = profileByDid[activity.userDid];
              return (
                <div
                  key={`${activity.userDid}-${activity.hiveId}-${activity.createdAt}`}
                  class="flex gap-3 border-b border-border pb-4 last:border-0 last:pb-0"
                >
                  <a href={`/profile/${handle}`} class="shrink-0">
                    {prof?.avatar ? (
                      <img
                        src={`/images/w_100/${prof.avatar}`}
                        alt=""
                        class="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div class="bg-muted h-10 w-10 rounded-full" />
                    )}
                  </a>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm">
                      <a
                        href={`/profile/${handle}`}
                        class="text-foreground font-semibold hover:underline"
                      >
                        @{handle}
                      </a>
                      <span class="text-muted-foreground"> finished </span>
                      <a
                        href={`/books/${activity.hiveId}`}
                        class="text-foreground font-semibold hover:underline"
                      >
                        {activity.title}
                      </a>
                    </div>
                    {activity.stars != null && (
                      <div class="text-amber-500 text-sm">
                        {"★".repeat(Math.round(activity.stars / 2))}
                      </div>
                    )}
                    {activity.review && (
                      <p class="text-muted-foreground mt-1 line-clamp-2 text-sm">
                        {activity.review}
                      </p>
                    )}
                    <div class="text-muted-foreground mt-1 text-xs">
                      {formatDistanceToNow(new Date(activity.createdAt), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                  {(activity.cover || activity.thumbnail) && (
                    <a href={`/books/${activity.hiveId}`} class="shrink-0">
                      <img
                        src={activity.cover || activity.thumbnail || ""}
                        alt=""
                        class="h-16 w-12 rounded object-cover"
                      />
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
