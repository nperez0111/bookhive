# Data & Caching Notes

Background for the caching/indexing rules referenced from `AGENTS.md`. If you're touching
`src/data/authorStats.ts`, `src/data/exploreGenres.ts`, `src/data/communityStats.ts`,
`src/middleware/anon-page-cache.ts`, `src/core/cacheHeaders.ts`, or the DB/KV vacuum logic in
`src/context.ts`, read this first.

## `bun:sqlite` is synchronous — a slow query is a whole-worker outage

`stmt.all()` blocks the event loop, and production runs 3 processes (`WEB_CONCURRENCY`, see
AGENTS.md). A 3s aggregate on a request path stalls a third of _all_ traffic, not just that route.

Expensive aggregates are therefore cached with **stale-while-revalidate**
(`ttl`/`revalidateAfter` via `lib/readThroughCache.ts`), never a plain TTL — a plain TTL makes
every expiry a synchronous cliff for whichever request draws the short straw. The entry is
stamped **after** the fetch resolves, so a slow fetch isn't born stale.

- `data/authorStats.ts` / `data/exploreGenres.ts` — `/explore`, `/explore/authors`, XRPC
  `getExplore`/`listGenres` all call the same cached helper; they used to each wrap the same query
  in a different policy, one of which was no cache at all.
- `data/getLanguages.ts`'s `getAvailableLanguages` — a full `GROUP BY` over the 356k-row / 1.62 GB
  `hive_book`, awaited by `resolveLanguage` on the request path of five routes. Its KV key carries
  a version suffix (`authors:stats:v1:` does the same) since nothing sweeps non-`page:` keys.
- `data/landingHighlights.ts` — `/`'s trending + recent lists. `/` isn't in the anon page cache's
  prefixes, so this is the only thing in front of it.
- `data/activeUsers.ts` / `data/communityStats.ts` — `/`'s distinct reader count and community
  totals. The inner reader count uses a 24h TTL / 1h revalidate; the combined aggregate uses a 7d
  TTL / 24h revalidate and returns `null` on a cold failure so the marketing page can omit the
  section rather than fail. A reader must have at least one shelfed row (`status IS NOT NULL`), so
  owned-only records do not inflate the count. Finished-last-week is a rolling seven-day window
  bounded at the current time, excluding future-dated rows.

## Request-stage timings must survive into logs

The wide-event middleware records completed Hono timings as `server_timing_ms`, reading the
current request's metric buffer before outer `timing()` emits its header. It deliberately does
not parse response headers (which may belong to an earlier cached render), descriptions, or
unfinished timers; the outer `total` is still available as request `duration_ms`. At most 64
completed metrics are inspected. Overlapping/parallel stages are elapsed waits, not additive
CPU or SQLite execution times.

Catalogue search records `search_upstream_ms` (Goodreads lookup), `search_persist_ms`
(catalogue/identifier writes and enrichment enqueue), `search_local_ms` (local FTS), and
`search_lookup_ms` (the entire cached/deduplicated lookup). XRPC additionally measures
`search_hydrate_ms`, `search_genres_ms`, `search_session_ms`, and `search_statuses_ms` when
those stages run. Only these fixed, finite, nonnegative numeric fields are promoted to
`Server-Timing`; no query strings, identities, or arbitrary business context become headers.
Cache hits/deduplicated waiters have lookup timing but no invented upstream timings. Book
pages also time `book_recommendations` separately from the enclosing parallel query group.
These measurements do not change search ordering, discovery, cache or timeout policy.

## The `/explore` aggregates: `INDEXED BY idx_hive_book_stats` is not decoration

Migration 024 added `hive_book(id, ratingsCount, rating, language)` so the
`hive_book_author`/`hive_book_genre` join in these aggregates can be index-only. But **this
database has never been `ANALYZE`d** — with no `sqlite_stat1` the planner prefers the UNIQUE
`sqlite_autoindex_hive_book_1` for an `id = ?` equality and fetches the whole row from the 1.62 GB
table anyway, so the index does nothing unless the query names it.

Measured at 350k books: `/explore/authors` 2742ms → 260ms, `/explore`'s genre list 209ms → 21ms.
Don't "clean up" the hint, and don't reach for `ANALYZE` instead — it would re-plan every query in
an app whose indexes were all tuned against the no-stats planner. `src/data/authorStats.test.ts`
asserts the plans.

## Landing activity must limit before joining catalogue rows

The November 7 speed audit measured the landing page's recent-activity query at 5,561ms:
joining first chose `idx_user_book_hive_feed` and sorted the whole library before LIMIT 10.
`landingHighlights.ts` now selects the newest user-book page in a limited subquery before
the LEFT JOIN, using existing `idx_user_book_created_at`. Keep both creation-date/URI ordering
terms in the inner and outer queries, and keep unmatched catalogue rows. The new query's
read-only production check returned ten rows in 5ms; this is a single warmed comparison, not
an end-to-end latency guarantee. SWR remains useful but cannot make synchronous refresh SQL
nonblocking. No new index or cache policy is needed.

## Catalogue pages and author recommendations select IDs before hydrating full rows

`data/catalogBooks.ts`'s `listBooksByGenre` first selects ordered page IDs and then hydrates only
that page. Without a substring `q`, the ID query explicitly uses `idx_hive_book_stats` for a
covering lookup: simply selecting IDs without the hint still reads wide table rows on the
no-`ANALYZE` planner. With `q`, `rawTitle`/`authors` require a table lookup, so that path keeps
the normal planner but still avoids sorting full descriptions/metadata. The count predicate
must match the selected IDs. Preserve language preference before LIMIT, the final unique ID
tie-breaker, and relevance's genre-rowid **ascending** order (earlier ingestion, not newest).

One-off audit experiment (not a checked-in benchmark): 350k synthetic books, 1,683MiB migrated
SQLite DB, 8MiB SQLite cache, mmap off,
no `ANALYZE`, warm OS cache, median of three SQLite-cache-reset runs. Old popularity query versus
the complete new helper (count, IDs, hydration): Fiction 1507ms → 70ms, Fantasy 300ms → 30ms,
Contemporary 220ms → 22ms. These are local measurements, not verified production latency gains.
No new index or query-result cache is required; scheduling synchronous SQL in the background
would still block the same worker.

Author pages and `bookDetail.ts`'s same-author recommendations use the same covering-ID-first
selection through `buildAuthorBookIdsQuery`, then hydrate only the selected page. The November 7
audit found over 32,000 books under Unknown Author; all five sampled slow book pages belonged
to that group. One read-only comparison of six recommendations was 5,251ms for full-row sorting
versus 825ms for covering IDs plus hydration, with identical ordered IDs (warm-cache/order bias
applies). Preserve exact author identity, pre-LIMIT language preference/exclusion, reviews versus
popularity ordering, unique ID ties, and listing offsets. No new index or result cache is added.

## Profile and PDS directory refresh must not block stale readers

The October 25 audit found profile and `/pds` requests taking roughly 10–12s. The batch profile
reader awaited stale refreshes and then returned the old cached values anyway. The logs did not
identify the exact stage responsible for each slow request, but the stale-cache blocking was real.

`services/getProfile.ts` shares one single/batch implementation, including the navbar's own
profile (`context.ts`). The `profile:` mount uses unstorage's existing LRU driver: at most 10,000
entries per process, with a native 30d TTL. Each entry stores `{ profile, fetchedAt }` atomically;
do not use `setMeta` here, since unstorage stores metadata as a second, independently evictable
LRU entry. Profiles are fresh for 24h; retained stale values return immediately while refresh
runs in the background. In-flight work is deduplicated per KV instance and viewer/public key:
never share authenticated profile state across viewers. Cookie-only `getSessionDid()` identifies
the viewer before the lookup, so fresh hits never wait for OAuth and stale refreshes restore the
session in the background. If restoration fails, public fallback uses only the public cache,
never populating a viewer key. Contexts without the cookie helper must restore before lookup.

Requests batch 25 actors under a process-wide concurrency of 3, with at most 12 queued batches
and a 500ms queue deadline. Each request gets a 2.5s abort signal; the fetch wait is bounded at
3s (not including session restoration or cache reads). Slots remain held until the underlying
request settles; responses arriving after that deadline cannot populate the cache.

The LRU deliberately replaces SQLite persistence, separate freshness metadata, negative caching,
and failure backoff. Missing actors remove old entries; transport failures leave stale values
and their original freshness untouched. Failures/absences may therefore be retried on the next
read (subject to in-flight deduplication and the shared limiter). Entries can be evicted before
30d, workers do not share warm profiles, and a restart starts cold. Existing SQLite profile rows
are no longer read or written; no destructive cleanup/migration is needed.

`pds/repoCache.ts`, used by `pds/client.ts`'s `listRepos`, caches the public repository directory
in-process: 5min fresh, 24h stale, one in-flight traversal, 30s failure backoff. A single 2.5s
deadline covers all pages, with cancellation, repeating-cursor detection and a 10-page ceiling
(1,000 repos per page). Never publish a partial traversal as a complete directory. On failure,
return a usable stale snapshot or an empty directory; admin credentials and viewer state never
enter this cache. If a transport ignores cancellation, its traversal keeps the singleton guard
until it actually settles, even after the caller's timeout/backoff expires. Both caches are per
web process, not distributed locks. The PDS directory retains its independent policy; it does
not use the profile LRU.

## Invalid AppView handles are not identities

On November 6, Bluesky returned `handle.invalid` for a migrated account even though its
handle endpoint and PLC document agreed on its current handle. Profile fetches previously
wrote that placeholder into both identity-cache directions: unrelated accounts overwrote
the shared `handle.invalid` reverse lookup. `bsky/id-resolver.ts` now rejects placeholder
writes/resolution, and uses `identity:v2:` keys to ignore existing poisoned entries without
deleting production data. Old persisted keys remain unused; no destructive cleanup is required.

`services/getProfile.ts` repairs placeholder profiles (including fresh LRU entries) through
the bidirectionally verified resolver, with a bounded wait. Viewer-specific profile fields
are preserved; if AppView refresh fails, even a placeholder-bearing cached profile remains
available with its original freshness. Successful missing-actor responses still remove it.
Waiting on a cached invalid profile has a 3s end-to-end limit, including OAuth restoration;
on timeout the viewer-safe cached value is returned while the shared repair continues.
Failed verification never invents or caches a handle; unresolved profiles can retry on the next
read rather than gaining negative-cache/backoff policy. User-facing profile, stats, shelf and
share URLs prefer a usable handle for readability, falling back to the DID only when it is
invalid or unavailable. `pages/utils/actorLinkId.ts` owns that selection using the existing
atcute-backed `isUsableHandle` guard; `handle.invalid` is never a routing identity.
DID profile/stat routes display the usable fetched handle when available.

Verified handle-to-DID and DID-to-handle traversal share a process-wide limiter across resolver
instances: 3 active, 12 queued, 500ms queue deadline, a 2.5s abort signal and a 3s caller wait.
The November 8 timing logs exposed unresolved handle lookups waiting about 135s because only
the reverse direction previously had these bounds. Both now use the same budget; existing
verification and cache semantics remain unchanged. Timers cannot enforce wall-clock deadlines
while the event loop itself is stalled. Identity-cache in-flight deduplication coalesces callers
for the same identity. A caller timeout
does not release capacity: the underlying actor-resolution promise must actually settle.
This bounds observable traversals, not every transport inside the resolver. The upstream
DNS/HTTP race can finish via HTTP while its uncancellable Node DNS loser is still running;
abort is checked after DNS settles. We retain that resolver behavior, not a custom DNS stack.

## Anonymous page cache (`src/middleware/anon-page-cache.ts`)

Serves GET requests without a `sid` cookie on `/books/*`, `/explore*`, `/authors/*` from KV
(gzipped HTML, 1h TTL). Prod-only.

- **The key percent-encodes the query; never join it with a literal `?`.** unstorage's
  `normalizeKey` discards everything after `?`. A `?`-joined key collapses every variant of a path
  onto one entry — `/explore?lang=French` served the English render, `/authors/X?page=2` served
  page 1. The key is `page:{pathname}:q:{encodeURIComponent(query)}`.
- **The size limit (`MAX_STORED_BYTES`, 256 KB) is measured on the bytes we store, i.e. after
  gzip**, with a separate 4 MB ceiling on the uncompressed buffer purely to bound memory. Comparing
  the uncompressed body instead rejected pages that would have cost ~25 KB of KV — production
  inlines the whole CSS bundle into `<head>` and `/explore/authors` renders 500 rows on top of it.
  A rejected page sets no `x-page-cache` header at all; `curl -sD- <url>` is the diagnostic.
- **Read/extraction/write failures are optional-cache failures, not page failures.** A failed
  persistence step keeps the rendered response (and coalesced waiters) successful, without marking
  the writer's response as a cache miss. Request wide events record `page_cache_error` as
  `read`, `extract`, or `write`. The clone is read incrementally and abandoned once it exceeds
  4 MiB; buffering the entire clone before checking the limit doesn't bound memory.
- **Only two response extractions may hold raw-body chunks per process.** Further fills skip
  the optional cache immediately, without a waiting queue or cloning the response. The slot is
  held through compression and released on success, oversize and errors. This bounds retained
  extraction chunks to 8 MiB, not total request memory: concatenation/compression, original response
  bodies and cached-hit decompression still allocate separately. `runtime_sample` includes
  `page_cache_active_fills`, `page_cache_buffered_bytes` (retained chunks only), and cumulative
  `page_cache_skipped_fills` so shedding is visible without per-URL metric labels.
- **`page:` has its own connection with a 50ms busy timeout; durable KV retains 10s.** On
  November 3, eight page-cache writes surfaced `SQLITE_BUSY` as HTTP 500 after ~10s, aligned with
  the primary's 15-minute cleanup. Production's expiry DELETE scanned the unindexed table.
  The primary attempts to initialize `idx_page_cache_updated_at` before siblings start; this is
  KV schema, not a migration of the main database. Each page connection also initializes its own
  schema (`:memory:` connections are independent). Initialization failure does not prevent startup:
  that worker uses a no-op page mount and skips maintenance. The mount skips lazy schema creation
  on requests. Select the SQLite or no-op driver before mounting: unstorage rejects a second
  mount at the same prefix rather than replacing the first one.
- **Cleanup releases the writer lock between 100-row batches**, yielding to requests, with
  at most 100 batches / 5s between batches per sweep. It retains the 2h expiry cutoff and 15-minute
  schedule, prevents overlapping sweeps, and reduces incremental vacuum from 1000 to 100 pages.
  `page_cache_sweep` logs deleted rows, batches, delete/vacuum/total durations, errors and whether
  the batch/time budget was exhausted. A SQLite page count is not a wall-clock guarantee; these
  timings distinguish DELETE from vacuum before further tuning. Remaining expiry work waits for
  the next sweep. A 50ms busy timeout bounds lock waiting, not query execution or disk latency.

## `?lang=` must be validated, everywhere

`resolveLanguage` (`src/data/getLanguages.ts`) validates against `getAvailableLanguages` rather
than passing the query param through. It keys the cached aggregate above _and_ sits in the anon
page cache's `ALLOWED_QUERY_PARAMS`, so an arbitrary string is an unbounded KV-cardinality and CPU
amplifier — every language a crawler invents becomes its own cache entry with a fresh cold render.
Apply it on **every** page that takes `?lang=`, including the paginated catalogue pages
(`/explore/genres/:genre`, `/authors/:author`), not just the three `/explore*` pages — both of
those used to read `c.req.query("lang") || undefined` straight into `CASE WHEN language = ?`.

## Caching policy (`src/core/cacheHeaders.ts`)

One rule: **signed in (`sid` cookie) → `private, no-store` on every path; signed out → cache
aggressively** so Cloudflare absorbs scraper load. Applied by `cacheControl()`/`setCacheControl()`
(`src/routes/lib.ts`), the anon page cache's bypass, and `server/plugins/cache-headers.ts` (the
nitro `response` hook — authoritative, since it runs on the final `Response`). It also adds
`Vary: Cookie` to all HTML and owns the long TTL for files under `public/`.

Two traps this encodes:

- **Never put an extension glob in `routeRules`.** rou3 truncates a pattern at the first `**`, so
  `/**/*.png` is really `/**` and matches every route — nitro's route-rule header middleware then
  overwrites the Hono-set `Cache-Control` on any 2xx. That's how `/home` and `/profile/*` were once
  sent as `public, max-age=2592000`, letting a browser replay the previous account's page after a
  switch. Prefix globs (`/assets/**`) are fine.
- **`Vary: Cookie` is load-bearing for `/`**, which 302s to `/home` when signed in and serves
  marketing HTML otherwise. Without it a browser replays the stored marketing page and the
  redirect never fires. Cloudflare ignores `Vary` except `Accept-Encoding`, so the edge needs its
  own _bypass cache when `http.cookie contains "sid="`_ rule.

## VACUUM and FTS rebuild (`src/context.ts`)

- **Main DB**: VACUUMed only when there's something to reclaim — gated on its own
  `freelist_count / page_count` against `VACUUM_FREELIST_RATIO` (0.25). Measured against
  production (356,675 books, 1.62 GB), an unconditional VACUUM costs **22.3s and frees nothing**
  (the file is essentially append-only). Don't restore the unconditional VACUUM.
- **KV** (`vacuumKvIfBloated`): delete-heavy (1.94 GB holding 34.7 MB of live rows). VACUUMs
  whenever the ratio is exceeded **or** `auto_vacuum` isn't yet INCREMENTAL — switching to
  incremental only takes effect through a VACUUM. Expect one unconditional VACUUM the first time
  this ships, bloat-driven after.
- **`hive_book_fts`** is rebuilt whenever the main-DB VACUUM runs. It's an external-content FTS5
  table keyed by `hive_book`'s implicit rowid (`id` is TEXT, not an `INTEGER PRIMARY KEY` alias),
  and SQLite documents that VACUUM "may change the ROWIDs of entries in any tables that do not have
  an explicit INTEGER PRIMARY KEY." If it ever does, every search result silently points at the
  wrong book — FTS5's own `'integrity-check'` does **not** detect this class of desync. `'rebuild'`
  is ~1s at 356k rows, so it just always runs alongside the VACUUM.

## `searchLocalCatalog` is the one "which books match this string"

`data/catalogBooks.ts`. There used to be three: `services/searchBooks.ts` used the FTS5 index,
while XRPC `searchBooks` and the `/shelves/:handle/:rkey` book picker each open-coded
`LIKE '%…%'` — `SCAN hive_book` plus a temp B-tree over 356k rows at 633-725ms, synchronously, on
the shelf picker's every keystroke. They also disagreed on which column: the FTS table indexes
`title`, `rawTitle` and `authors`; the two `LIKE` copies searched only one each. `rawTitle` is the
un-normalised scraped title, so a book whose title was normalised away from it was findable in one
and not the other.

Broad FTS prefixes can still stall a worker if every match joins a wide `hive_book` row before
sorting. Migration 031 adds `idx_hive_book_search_rank(ratingsCount DESC, rating DESC, id ASC)`.
`searchLocalCatalog` probes at most 513 FTS rowids: up to 512 matches use direct rowid lookups;
larger sets use the ordered **covering** rank index, filtering against **all** matching FTS rowids.
The probe chooses a plan, never a candidate cutoff. The broad plan avoids both wide table reads
and a temporary popularity sort; rare/no-match searches avoid scanning the rank index. Exclusions,
limits, prefix syntax and popularity/id tie ordering are unchanged. `services/searchBooks` now
calls this helper too instead of keeping a second FTS query (previously without an id tie-break).

Local synthetic measurements (100k books, 4 KiB descriptions, 8 MiB SQLite page cache, warm OS
cache, three page-cache-reset runs) reduced a 50k-match prefix from about 20–22ms to 5.6–5.8ms,
and an all-catalogue author match from 22–23ms to 11–11.3ms, including the probe. These are
fixture results, not a promise for production's multi-second tail: event-loop/host stalls also
inflate the logged `search_local_ms`. Check that stage after deployment rather than attributing
every long search to FTS. No query-result cache or changes to the Goodreads-first search policy.
