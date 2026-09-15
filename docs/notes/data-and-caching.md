# Data & Caching Notes

Background for the caching/indexing rules referenced from `AGENTS.md`. If you're touching
`src/data/authorStats.ts`, `src/data/exploreGenres.ts`, `src/middleware/anon-page-cache.ts`,
`src/core/cacheHeaders.ts`, or the DB/KV vacuum logic in `src/context.ts`, read this first.

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
