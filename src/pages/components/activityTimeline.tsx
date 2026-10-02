import { type FC } from "hono/jsx";
import { format } from "date-fns";
import { TimeAgo as Timestamp } from "./TimeAgo";

import type { FeedGroup, FeedItem } from "../../data/activityFeed";
import type { ProfileViewDetailed } from "../../types";
import { avatarImageUrl } from "../../core/imageUrl";
import { authorsDisplay, CoverImage, normalizeBookData } from "./BookCard";
import { StarDisplay } from "./cards/StarDisplay";
import { starsToDisplayRating } from "../../core/rating";

/**
 * The activity feed, as an actual timeline. Renders as an `<ol>` rather than a
 * cover grid — a grid has no single reading order, so even correctly-sorted
 * activity reads as shuffled.
 */

type Ctx = {
  didHandleMap: Record<string, string>;
  profileByDid: Record<string, ProfileViewDetailed>;
};

function handleFor(did: string, ctx: Ctx): string {
  return ctx.didHandleMap[did] || did;
}

const Avatar: FC<{ did: string; ctx: Ctx }> = ({ did, ctx }) => {
  const handle = handleFor(did, ctx);
  const avatar = ctx.profileByDid[did]?.avatar;
  return (
    <a href={`/profile/${handle}`} class="focus-ring shrink-0 rounded-full" tabindex={-1}>
      {avatar ? (
        <img
          src={avatarImageUrl(did, { size: 80 })}
          alt=""
          loading="lazy"
          width="40"
          height="40"
          class="bg-muted h-10 w-10 rounded-full object-cover"
        />
      ) : (
        <div class="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold">
          {handle.slice(0, 1).toUpperCase()}
        </div>
      )}
    </a>
  );
};

/**
 * Intrinsic `width`/`height` matter here: without them, lazy-loaded covers
 * reflow the list, which on a chronological feed looks like the content
 * reordering itself.
 */
const RowCover: FC<{ item: FeedItem }> = ({ item }) => (
  <a
    href={`/books/${item.book.hiveId}`}
    class="focus-ring book-cover-frame shrink-0 overflow-hidden rounded"
    tabindex={-1}
  >
    <CoverImage book={normalizeBookData(item.book)} class="h-[66px] w-11 rounded object-cover" />
  </a>
);

const SingleRow: FC<{ item: FeedItem; ctx: Ctx }> = ({ item, ctx }) => {
  const handle = handleFor(item.actorDid, ctx);
  const { book } = item;
  return (
    <li class="flex items-start gap-3 py-3">
      <Avatar did={item.actorDid} ctx={ctx} />
      <div class="min-w-0 flex-1">
        <p class="text-sm leading-snug">
          <a
            href={`/profile/${handle}`}
            class="focus-ring text-foreground font-semibold hover:underline"
          >
            @{handle}
          </a>
          <span class="text-muted-foreground"> {item.verb} </span>
          <a
            href={`/books/${book.hiveId}`}
            class="focus-ring text-foreground hover:text-primary font-semibold"
          >
            {book.title}
          </a>
          {book.authors && (
            <span class="text-muted-foreground"> by {authorsDisplay(book.authors)}</span>
          )}
        </p>
        {book.stars != null && book.stars > 0 && (
          <StarDisplay rating={starsToDisplayRating(book.stars) ?? 0} size="sm" class="mt-1 flex" />
        )}
        {book.review && (
          <p class="text-muted-foreground mt-1 line-clamp-2 text-sm italic">“{book.review}”</p>
        )}
        <Timestamp ts={item.ts} class="mt-1 block" />
      </div>
      <RowCover item={item} />
    </li>
  );
};

/**
 * A burst row — collapses a run of same-actor activity (e.g. a CSV import)
 * into one row. `-space-x-5` with a `ring-background` ring gives the
 * deck-of-cards read; the ring separates the covers rather than a border,
 * which would fight `.book-cover`.
 */
const BurstRow: FC<{
  group: Extract<FeedGroup, { kind: "burst" }>;
  ctx: Ctx;
}> = ({ group, ctx }) => {
  const handle = handleFor(group.actorDid, ctx);
  const covers = group.items.slice(0, 5);
  return (
    <li class="flex items-start gap-3 py-3">
      <Avatar did={group.actorDid} ctx={ctx} />
      <div class="min-w-0 flex-1">
        <p class="text-sm leading-snug">
          <a
            href={`/profile/${handle}`}
            class="focus-ring text-foreground font-semibold hover:underline"
          >
            @{handle}
          </a>
          <span class="text-muted-foreground"> {group.verb} </span>
          <span class="text-foreground font-semibold tabular-nums">
            {group.total}
            {group.truncated ? "+" : ""} books
          </span>
        </p>
        <p class="text-muted-foreground mt-1 truncate text-xs">
          {group.items
            .slice(0, 3)
            .map((i) => i.book.title)
            .join(", ")}
          {group.total > 3 && ` and ${group.total - 3} more`}
        </p>
        <Timestamp ts={group.ts} class="mt-1 block" />
      </div>
      <div class="flex shrink-0 -space-x-5">
        {covers.map((item, idx) => (
          <a
            key={item.uri}
            href={`/books/${item.book.hiveId}`}
            class="focus-ring book-cover-frame overflow-hidden rounded"
            style={`z-index:${covers.length - idx}`}
            tabindex={-1}
          >
            <CoverImage
              book={normalizeBookData(item.book)}
              class="ring-background h-[66px] w-11 rounded object-cover ring-2"
            />
          </a>
        ))}
      </div>
    </li>
  );
};

/**
 * The server doesn't know the viewer's timezone, so buckets are UTC days and
 * the separator renders a real date. The inline script below relabels the two
 * newest to "Today"/"Yesterday" only when they match the browser's local date
 * — with JS off you still get a real date, never a wrong "Today".
 */
function dayKey(ts: string): string {
  return ts.slice(0, 10);
}

export const ActivityTimeline: FC<{
  groups: FeedGroup[];
  didHandleMap: Record<string, string>;
  profileByDid: Record<string, ProfileViewDetailed>;
}> = ({ groups, didHandleMap, profileByDid }) => {
  const ctx: Ctx = { didHandleMap, profileByDid };
  let lastDay: string | null = null;

  return (
    <ol class="divide-border divide-y">
      {groups.map((group) => {
        const ts = group.kind === "single" ? group.item.ts : group.ts;
        const day = dayKey(ts);
        const separator = day !== lastDay ? day : null;
        lastDay = day;

        return (
          <>
            {separator && (
              <li
                data-feed-day={separator}
                role="presentation"
                class="bg-background/85 sticky top-0 z-20 -mx-2 px-2 py-2 backdrop-blur"
              >
                <h2 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  <time datetime={separator}>
                    {format(new Date(`${separator}T00:00:00Z`), "PP")}
                  </time>
                </h2>
              </li>
            )}
            {group.kind === "single" ? (
              <SingleRow item={group.item} ctx={ctx} />
            ) : (
              <BurstRow group={group} ctx={ctx} />
            )}
          </>
        );
      })}
    </ol>
  );
};
