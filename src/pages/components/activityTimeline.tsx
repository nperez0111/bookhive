import { type FC } from "hono/jsx";
import { format, formatDistanceToNowStrict } from "date-fns";

import type { FeedGroup, FeedItem } from "../../utils/activityFeed";
import type { ProfileViewDetailed } from "../../types";
import { avatarImageUrl } from "../../utils/imageProxy";
import { authorsDisplay, CoverImage, normalizeBookData } from "./BookCard";
import { StarDisplay } from "./cards/StarDisplay";

/**
 * The activity feed, as an actual timeline.
 *
 * It used to render through `BuzzSection` — a 2-to-5 column cover grid built for
 * the "recently read" shelves. A grid has no single reading order (across or
 * down are both defensible), so even correctly-sorted activity read as
 * shuffled. An `<ol>` has exactly one reading order and screen readers announce
 * the position, so the semantics carry the fix.
 *
 * `formatDistanceToNowStrict`, not `formatDistanceToNow`: the fuzzy one emits
 * "about 2 months ago" and "almost 1 year ago", whose hedges and lengths vary
 * between adjacent rows and read as inconsistency even when the order is right.
 *
 * Every timestamp is a `<time datetime>` with a `title` — the absolute time was
 * previously nowhere in the app, so a reader who found a row's placement
 * confusing had no way to check it.
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
 * Intrinsic `width`/`height` on every image is not decoration here. Covers are
 * the only variable-height thing in a row, and without them a 25-row list
 * reflows 25 times as lazy images resolve — which on a chronological list looks
 * exactly like the content reordering itself, i.e. the bug being fixed.
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

const Timestamp: FC<{ ts: string; class?: string }> = ({ ts, class: className }) => (
  <time
    datetime={ts}
    title={format(new Date(ts), "PPPp")}
    class={`text-muted-foreground text-xs tabular-nums ${className ?? ""}`}
  >
    {formatDistanceToNowStrict(new Date(ts), { addSuffix: true })}
  </time>
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
          <StarDisplay rating={book.stars / 2} size="sm" class="mt-1 flex" />
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
 * A burst row. This is what a CSV import looks like now: the worst single-user
 * burst measured on production was 513 books sharing one minute, which used to
 * be roughly twenty consecutive pages of one person's backlog.
 *
 * `-space-x-5` with a `ring-background` ring gives the deck-of-cards read; the
 * ring is what separates the covers from each other, rather than a border that
 * would fight `.book-cover`.
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
 * The server has no idea what timezone the viewer is in — there is no tz cookie
 * anywhere in this app — so buckets are UTC days and the separator renders a
 * real date, which is never wrong. The inline script below relabels the two
 * newest to "Today"/"Yesterday" only when they match the browser's local date.
 * With JS off you get real dates rather than a wrong "Today".
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
