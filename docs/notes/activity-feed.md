# Activity Feed Notes

Background for `src/data/activityFeed.ts`, `src/db.ts`'s `feedActivityIndexedAt`, migration 027,
and the `/feed`, XRPC `getFeed`/`getProfile`, and `/rss/*` surfaces that all read the same feed.

## The feed sorts by `indexedAt`, and whatever it sorts by is what it must display

It used to order by `user_book.createdAt` while every card rendered
`formatDistanceToNow(indexedAt)`. The two disagreed on the day for **55% of rows**, so the visible
timestamps ran non-monotonically ("2h ago, 3d ago, 10m ago, 1y ago") and users reasonably read the
feed as shuffled. `createdAt` can't be the key: it mirrors a frozen field of the user's PDS record
(`getBook.ts` — "Always prefer original values"), so finishing a book or writing a review never
moved it.

Three things hold this together, and only work together:

- **`feedActivityIndexedAt`** (`src/db.ts`) is the `ON CONFLICT` expression every `user_book`
  upsert uses for `indexedAt`. It advances only when a field the feed renders actually changed
  (`status`/`stars`/`review`/`finishedAt`/`owned`), because `refetchBooks` stamps **one** timestamp
  across a whole library re-sync — which used to re-date a user's entire back catalogue to "a few
  seconds ago". Don't simplify it to a `cid` comparison: `cid` also moves for cover re-uploads,
  `hiveBookUri` backfill, title normalisation, and every KOReader progress ping. And it must stay
  `IS NOT`, not `<>` — `<>` against NULL yields NULL, the `CASE` takes the `ELSE`, and rating a book
  for the first time stops counting as activity. `src/db.feedActivity.test.ts` pins this.
- **Migration 027's clamp** makes the _existing_ rows usable. Fixing only the write path leaves the
  feed monotonic but wrong: ordered by who re-synced most recently.
- **The migration-027 indexes** (`user_book(indexedAt, uri)` and the `userDid`/`hiveId`
  composites). Measured on production data, the `all` tab ordered by `indexedAt` without them
  degrades to a full scan plus a temp B-tree — **33ms against 1ms**. `uri` is the keyset tiebreaker
  in each one: 5,262 distinct timestamps were shared by 2+ rows, and SQLite may order ties
  differently between two identical requests, silently dropping rows from a paginated feed.
  `src/data/activityFeed.test.ts` asserts the plans.

## Bursts are collapsed by actor alone, in JS, after the fetch

One user's CSV import held 19 of 25 slots on feed page 1; the worst measured burst was 513 books
in one minute. Grouping by `(actor, verb)` doesn't work — a live re-sync interleaves "finished" and
"wants to read" row by row, so a verb-sensitive key breaks the run every one or two rows and leaves
the flood in place (a mixed burst is labelled "logged" instead). Collapsing in SQL is also wrong:
knowing where a run _ends_ means reading past the page boundary, defeating the `LIMIT` the keyset
scan depends on.

**The cursor must come from the last raw row consumed, never the last display row** — a cursor
taken from a collapsed burst's newest row re-serves that burst forever.

## RSS (`/rss/*`) is dated and ordered by the same `indexedAt`

`activityRows` mirrors `buildFeedQuery` exactly, including the `uri` tiebreaker. Emitting
`createdAt` as `<pubDate>` while ordering by `indexedAt` would reproduce the
sorted-by-one-column-labelled-with-another bug in XML. Safe to re-date because
`<guid isPermaLink="false">` is the AT URI and doesn't change, so readers dedupe on it and nothing
re-notifies as unread — only sort position moves. Migration 027's clamp must land first, or every
row still carries a re-sync stamp and subscribers see one wholesale reorder on deploy.

## XRPC `getFeed` and `getProfile`

- `getFeed` paginates by **`cursor`, not `page`** (`app/hooks/useBookhiveQuery.ts` on the client).
  `page` is still accepted so shipped iOS builds calling `?tab=&page=` don't 400: page 1 answers
  normally, a page-2+ request without a cursor returns an **empty page with `hasMore: false`**
  (returning page 1 again kept `hasMore` true and those builds' `onEndReached` looped forever
  behind their own dedup). Output carries both a flat `activities` array (bursts expanded — never
  trim it, the cursor has already advanced past every row in it) and a `groups` array with the
  collapsed rows, each burst capped at an 8-item preview (`total` is the real count);
  `collapse=false` opts out of grouping entirely. `indexedAt` is the field to display — the handler
  used to return only `createdAt`, so web and iOS showed different times for the same item.
- `getProfile` returns `indexedAt` in the `createdAt` field on `activity` and `friendActivity`, **on
  purpose** — don't "fix" this back. The lexicon has no `indexedAt` field on this view, and adding
  one means a lexicon change plus an app release before any installed build could read it; the
  rename follows when the lexicon does. On `friendActivity` this decides _which_ 50 rows you see,
  not just their order.
- `books` keeps its true `createdAt` (`libraryView` vs `activityView` in the handler) because the
  app's shelf list has an explicitly labelled **"Date Added"** sort reading it
  (`app/app/(tabs)/books/[status].tsx`). Substituting activity time there would make a labelled
  control lie.

## "Books finished this year" — `core/readingYear.ts`

Four call sites used to answer this and disagreed on both halves. **Which year**: `finishedAt` is
a UTC ISO string, so the boundary is UTC — two sites used `Date.UTC`, two used local
`getFullYear()`, which only agree on a `TZ=UTC` host. **Whether a re-read counts**:
`/profile/:handle` walked `previousReads`, the `/og/profile/:handle` card didn't — a user who read
three books and re-read one saw 4 on their profile and 3 on the OG card, no timezone involved. Both
now count a re-read as a book read this year; the OG query does it via a `json_valid`-guarded
`json_each` over `previousReads`.

`data/readingStats.ts`'s `getReadingStatsForYear` is the one year-stats query, plus the
`MIN_BOOKS_FOR_YEAR_STATS` fallback — three surfaces derived this separately and disagreed (the
XRPC handler never imported the constant, so one URL gave all-time totals on the site and a
near-empty year on iOS).

Two orderings are deliberately **not** unified in `data/userShelves.ts`'s `listShelf` (it takes the
sort key as a parameter): **Currently reading** is an activity list and sorts by `indexedAt`,
**Want to read** is a queue and sorts by `createdAt`. Making the to-read list reshuffle whenever
you rate something would be the same labelled-control-lies bug as above.
