# BookHive — Agent Reference Index

Goodreads alternative built on Bluesky's AT Protocol. Server-rendered Hono JSX with minimal client-side hydration via `hono/jsx/dom`. Bun runtime, SQLite via Kysely, Tailwind CSS v4. Built with Vite+ (vite-plus, wrapping Vite 8 + Rolldown) + Nitro (preset `bun`), output to `.output/server/`.

## User preferences (do not remove this)

- Do not commit any changes to git unless otherwise instructed

## Keeping this document current (do not remove this)

This file is a living reference. **Whenever you change something this document
describes, update AGENTS.md in the same change** so it never drifts from the
codebase. This includes (non-exhaustive):

- Adding, removing, renaming, or moving routes, pages, components, or modules.
- Changing the DB schema, adding migrations, or altering table columns/keys.
- Adding/removing client hydration islands or worker bundles.
- Changing build/dev/test commands or the build pipeline.
- Adding/removing XRPC methods or lexicons.
- Changing middleware, context shape, or KV mounts.

Treat documentation updates as part of "done." If you notice this file is
already out of date while working, fix it.

## Input Validation

Routes must always validate inputs using either:

- **zValidator** (with Zod) for standard Hono routes — use `zValidator("query", schema)`, `zValidator("json", schema)`, or `zValidator("form", schema)` as appropriate.
- **XRPC router validators** for AT Protocol XRPC endpoints in `src/xrpc/`. Add lexicons & regenerate the generated types with `bun run lexgen`

## Architecture at a Glance

```
Browser ──> Bun.serve() ──> Hono app ──> Server-rendered JSX pages
                │                             │
                │ /_bundle (HTML import, dev)  ├── SQLite (Kysely ORM)
                │   └── entry.html             ├── KV cache (unstorage + SQLite)
                │       ├── src/client/index.tsx  ├── Bluesky PDS (ATProto writes)
                │       └── src/index.css      ├── Goodreads scrapers
                │                              └── Worker threads (see below)
                └── static files (public/)

Worker threads (bundled to .output/server/workers/):
  ingester-worker     — Jetstream firehose ingest          (src/workers/)
  og-render-worker    — OG image generation (React+takumi) (src/workers/)
  open-observe-worker — pino log shipping to OpenObserve   (src/workers/)
  import-worker       — CSV import processing              (src/workers/)
  parse-worker        — ebook metadata parse + cover raster (single-shot, src/workers/)
  waf-solver-worker   — AWS WAF challenge solve            (src/scrapers/waf/)
```

**Key patterns:**

- Server components (`src/pages/`) render full HTML. Only 6 islands are hydrated client-side (`src/client/`); one of them, the book page's `BookIslands`, renders into three mount points. Most interactivity is CSS-only (peer/checked selectors) or inline `<Script>` vanilla JS.
- **Production is multi-process**: `server/cluster.ts` spawns `WEB_CONCURRENCY` workers sharing port 8080 via SO_REUSEPORT — the code defaults to 4, but the deployed container sets **3** (verified on the host), which is the number every memory ceiling in this document is derived from. Worker 0 is the **primary** (`isPrimaryWorker`): only it runs migrations, VACUUM, the Jetstream ingester, and the enrichment drain.
- **Enrichment is queued, never inline**: routes call `enqueueEnrichment`/`enqueueEnrichmentBatch` (`src/utils/enrichQueue.ts`). The primary worker drains it every 5s at concurrency 3, with exponential backoff. `enrichBookWithDetailedData` holds its own semaphore (4) + 45s deadline. That drain interval × concurrency is also the **only** rate limit on requests to Goodreads — 36 fetches/min, healthy or not. Don't add a second one.
- **`enrich_queue.attempts` counts answers from Goodreads, not failures.** A run reports `enrich_retry` in the wide-event bag: `retry` spends an attempt, `defer` costs nothing and re-queues on a decaying schedule, `dead` tombstones the book immediately. Anything the app decided on its own — a WAF challenge, a timeout, a transport error — is a `defer`. Getting this wrong is expensive: when refusals counted as attempts, one 6h window wrote off 2,854 books for 7 days apiece **without sending a single request on their behalf** (98% of everything the queue gave up on). The bound on defers is `MAX_QUEUE_AGE_MS` (7d from `enqueuedAt`, which survives re-enqueue), not the attempt counter.
- **Author lookups use `hive_book_author` join** (mig 020), not `LIKE`. This is exact identity, not text search.
- **The `/explore` aggregates say `INDEXED BY idx_hive_book_stats`, and that is not decoration.** Each groups the whole of `hive_book_author`/`hive_book_genre` joined to `hive_book`, and migration 024 added `hive_book(id, ratingsCount, rating, language)` so that join can be index-only. But **this database has never been `ANALYZE`d** — with no `sqlite_stat1` the planner prefers the UNIQUE `sqlite_autoindex_hive_book_1` for an `id = ?` equality and fetches the whole row from the 1.62 GB table anyway, so the index does nothing unless the query names it. Measured at 350k books: `/explore/authors` 2742ms → 260ms, `/explore`'s genre list 209ms → 21ms. Don't "clean up" the hint, and don't reach for `ANALYZE` instead — it would re-plan every query in an app whose indexes were all tuned against the no-stats planner. `src/utils/authorStats.test.ts` asserts the plans.
- **`bun:sqlite` is synchronous, so a slow query is a whole-worker outage.** `stmt.all()` blocks the event loop, and production runs 3 processes — a 3s aggregate on a request path stalls a third of _all_ traffic, not just that route. Hence the explore aggregates are cached with **stale-while-revalidate** (`ttl: 24h, revalidateAfter: 1h`), not a plain TTL: a plain TTL makes every expiry a synchronous cliff for whichever request draws the short straw. The caching lives _inside_ `src/utils/authorStats.ts` / `src/utils/exploreGenres.ts`, not at the call sites — the three consumers (`/explore`, `/explore/authors`, XRPC `getExplore`) used to wrap the same query in three different policies, one of which was no cache at all.
- **Library re-sync** fans out at most `REFETCH_SEARCH_CONCURRENCY` (3) searches.

**The app shell scroller — never put `overflow-*-auto` on `<main>`.** The `jsxRenderer` in
`src/routes/main.tsx` wraps every app page in
`<main class="flex-1 overflow-x-clip [overflow-clip-margin:5rem] flex justify-center px-4 py-4 lg:px-6 lg:py-6">`
→ `<div class="mx-auto w-full min-w-0 max-w-5xl">`. Four constraints, each load-bearing:

- **`overflow-x-clip`, not `auto`.** `overflow-x: auto` with `overflow-y: visible` forces
  `overflow-y` to compute to `auto`, making `<main>` a scroll container on _both_ axes. Its height
  equals its content height, so it ends up with a few px of residual scrollable overflow that the
  mouse wheel latches onto and never chains out of — the page stopped scrolling ~26px in on
  `/books/:id`, `/profile/:handle` and `/explore`. A clip container is not a scroll container.
- **Not `overflow-visible` either.** `BookTooltip` is always rendered (at `opacity-0`), so its
  `w-48` box permanently contributes horizontal overflow; removing the clip produces a
  document-level h-scrollbar on grid pages at 768–1280px. `overflow-clip-margin` widens the clip
  edge instead so tooltips can overhang the column. `src/pages/components/book.tsx` does the same
  for the profile `BookList` panel.
- **`w-full min-w-0` on the inner column, and keep `flex justify-center`.** Without `w-full` the
  column is sized to max-content, so content-light pages silently render narrower. `min-w-0`
  keeps the flex floor deterministic. `justify-center` is the only thing centring the column at
  `lg`+, and `<main>`'s flex `align-items: stretch` is what makes `min-h-full` resolve for the
  `-mx-4 … min-h-full` full-bleed pattern on `explore.tsx` / `genres.tsx` / `authorDirectory.tsx`.
- **The gutter is `px-4 lg:px-6` PADDING on `<main>`, never a margin on the column.** It used to be
  `m-4 lg:m-6` on the column, next to `mx-auto` — but Tailwind v4 emits `margin-inline` after
  `margin`, so `mx-auto` won and the horizontal margin computed to **0 at every width below `lg`**.
  Every app page's content sat flush against both screen edges on mobile, and the `-mx-4 … px-4`
  full-bleed sections overhung the viewport by 16px per side and had their right edge clipped off
  (the "See all genres →" arrow on `/explore` was the visible tell). Padding can't be overridden by
  `mx-auto`, still lets the column centre itself, and keeps the negative-margin full-bleed trick
  cancelling exactly — `-mx-4` against `px-4` lands the bleed on the viewport edge, and the
  section's own `px-4` re-aligns its content with the rest of the page.

Wide content (the library/import tables) already clips itself, so `<main>` does not need to.

## Entry Points

| File                   | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `src/index.ts`         | Bun.serve — HTML bundle route + Hono fetch handler                             |
| `src/server.ts`        | Wires deps via `createAppDeps()` + `createApp()`; graceful shutdown            |
| `src/app.ts`           | Hono app factory — all middleware + route mounting                             |
| `src/entry.html`       | Bun HTML bundle entry (imports CSS + client JS)                                |
| `src/client/index.tsx` | Client bundle entry — mounts the hydrated islands (see Client-Side Components) |

## Routes

`src/app.ts` mounts infra/admin routes, then `/` → `src/routes/main.tsx` (`mainRouter`). `mainRouter` registers standalone pages, the image proxy, feature route modules, and the XRPC router.

**Middleware order** in `createApp`: `timing` → `prettyJSON` (dev) → context → wide-event logging → error capture → asset URLs (Vite manifest) → `/images/*` CORP override → `secureHeaders` → `compress` → `jsxRenderer` → OpenTelemetry → default `Cache-Control: private, no-store` → Prometheus `registerMetrics` → `etag` → anon page cache (prod).

**`etag()` must never see a large or streamed body** — it buffers the entire
response in memory. `/library/books/*`, `/opds/books/*` and `/import` are all
excluded **by prefix** in `src/app.ts` (`ETAG_EXCLUDED_PREFIXES`). `/import` is
also mounted above the middleware, but do not rely on that alone: its SSE stream
never ends, so if a reorder ever let the digest see it, imports would hang
forever and look like an import bug rather than an etag one.

Because those routes skip `etag()`, **they must answer `If-None-Match`
themselves** — the middleware is what turns a validator into a 304, and setting
the header alone does nothing. `streamPersonalBook`
(`src/utils/personalLibrary.ts`) takes the request's `If-None-Match` and returns
a `304` before it opens the file. Without it an e-reader re-downloads every book
on every sync.

**`streamPersonalBook` owns range requests too**, for the same reason — nothing
upstream will do it, and the three callers (OPDS, `/library`, XRPC
`getPersonalBookFile`) are thin adapters that just forward `Range`/`If-Range`
and return `new Response(stream, { status, headers })`. It returns one of
200/206/304/416 and always advertises `Accept-Ranges: bytes`, including on the
304 — the client that needs to resume is exactly the one that has seen a
validator before. Without resume, **any interrupted transfer is a total loss**:
CrossPoint reads exactly `Content-Length` bytes and hard-fails a short body
(`HttpDownloader.cpp`, "incomplete: got X of Y bytes") with no retry. `If-Range`
is honoured because our validator is a content hash, so a mismatch means a
genuinely different file and only the whole of the new one is a correct answer.
`Bun.file().slice()` seeks rather than reading the skipped prefix, so resuming
near the end of a 100 MB book costs nothing.

**`Content-Disposition` is built by `attachmentDisposition`
(`src/utils/contentDisposition.ts`), never by hand.** Two traps, both of which
shipped: `filename*=UTF-8''…` cannot be built with `encodeURIComponent`, which
leaves `' ( ) * ! ~` unescaped — and `'` is the ext-value's own delimiter, so
`The Handmaid's Tale.epub` parsed as the filename `The Handmaid`. And
`filename*` alone is not enough: a client that implements only the plain
`filename` has nothing to fall back to but the URL's last path segment.

**Anonymous page cache** (`src/middleware/anon-page-cache.ts`): serves GET requests without a `sid` cookie on `/books/*`, `/explore*`, `/authors/*` from KV (gzipped HTML, 1h TTL). Prod-only.

**The cache key percent-encodes the query; it must never be joined with a literal `?`.** unstorage's `normalizeKey` is `key.split("?")[0].replace(/[/\\]/g, ":")…` — it _discards the query string_. A `?`-joined key therefore collapsed every variant of a path onto one entry, which made `ALLOWED_QUERY_PARAMS` and the sorted-query construction dead code and served visibly wrong pages: `/explore?lang=French` got the English render, `/authors/X?page=2` got page 1, `/explore/genres/Y?sort=relevance` got the popularity sort. The key is now `page:{pathname}:q:{encodeURIComponent(query)}` — `encodeURIComponent` escapes `?`, `/` and `\`, the only characters `normalizeKey` touches. Changing the key format orphans the old rows; the 15-minute sweep in `src/context.ts` clears them at 2× TTL.

**The size limit is measured on the bytes we store, i.e. after gzip** (`MAX_STORED_BYTES`, 256 KB), with a separate 4 MB ceiling on the uncompressed buffer purely to bound memory. It used to compare the _uncompressed_ body against 512 KB and then store the gzipped form, which rejected pages that would have cost ~25 KB of KV. That matters because production inlines the whole CSS bundle into `<head>` (`getInlineCss`, `src/utils/manifest.ts`) and `/explore/authors` renders 500 author rows on top of it — near enough to the old ceiling to fall off it, and the failure is silent (a rejected page sets no `x-page-cache` header at all, which is the diagnostic: `curl -sD- <url>` and look for it).

**Caching policy** lives in one place: `src/utils/cacheHeaders.ts`. One rule —
**signed in (`sid` cookie) → `private, no-store` on every path; signed out →
cache aggressively** so Cloudflare absorbs the scraper load. Three layers apply
it: `cacheControl()`/`setCacheControl()` (`src/routes/lib.ts`), the anon page
cache's bypass, and `server/plugins/cache-headers.ts` — the nitro `response`
hook, which is authoritative because it runs on the final Response. It also adds
`Vary: Cookie` to all HTML and owns the long TTL for files under `public/`.

Two traps this encodes, both of which caused real bugs:

- **Never put an extension glob in `routeRules`.** rou3 truncates a pattern at
  the first `**`, so `/**/*.png` is really `/**` and matches every route — and
  nitro's route-rule header middleware overwrites the Hono-set `Cache-Control`
  on any 2xx. That is how `/home` and `/profile/*` came to be sent as
  `public, max-age=2592000`, letting a browser replay the previous account's page
  after an account switch. Prefix globs (`/assets/**`) are fine.
- **`Vary: Cookie` is load-bearing for `/`**, which answers a 302 to `/home` when
  signed in and marketing HTML otherwise. Without it a browser replays the stored
  marketing page and the redirect never fires. Cloudflare ignores `Vary` except
  `Accept-Encoding`, so the edge needs a _bypass cache when `http.cookie contains
"sid="`_ rule to get the same guarantee.

### Mounted in `src/app.ts` (infra/admin, before `mainRouter`)

- `/healthcheck` → JSON status + git sha
- `/metrics` → Prometheus
- `/admin/*` → `src/routes/admin.ts` (gated by `EXPORT_SHARED_SECRET`).
  `GET /admin/backfill-catalog/progress` reads **through the KV**, not just this
  process's memory: the backfill runs for hours on the primary worker while the
  request lands on any of the three, so an in-memory-only answer reported `idle`
  for a live job and lost the outcome of a finished one. A stored `running` is
  distinguished from a dead run via `nextBatchExpectedAt`: if the next batch is
  still expected (plus a 60s grace), report `running`; otherwise `interrupted`.
  **Persist the object, never `JSON.stringify` of it.** unstorage runs `destr`
  over whatever a driver returns, so a stored JSON string reads back as an
  object and any `JSON.parse` of it throws — which silently discarded every
  stored run. Same idiom as `enqueuePdsWrite`.
- `/debug/*` → `src/routes/debug.ts` (gated by `EXPORT_SHARED_SECRET`)
- `/import` (POST `/goodreads`, `/storygraph`) → `src/routes/import.ts` — CSV import handler

### Mounted in `src/app.ts` (after `mainRouter`)

- `/sitemap.xml` → static sitemap

### Standalone pages in `src/routes/main.tsx`

- `/privacy-policy` → `src/pages/privacy-policy.tsx`
- `/legal` → `src/pages/terms.tsx`
- `/pds` → `src/pages/pds.tsx` (redirects to `/` if PDS disabled)
- `/` → `src/pages/marketing.tsx` — landing for signed-out visitors; **302s to `/home` when the `sid` cookie is present** (`src/routes/main.tsx`), which is what makes `Vary: Cookie` load-bearing on this route (see Caching policy above)
- `/images/*` → signing reverse-proxy to **imgproxy** (`src/utils/imageProxy.ts`). Three route shapes:
  - `/images/books/:hiveId?w=N` — ID-keyed canonical (preferred). Helpers: `coverImageUrl`, `avatarImageUrl`
  - `/images/avatars/:did?s=N` — ID-keyed avatar
  - `/images/{modifiers}/{source}` — source-embedded catch-all (used by OG render, iOS app). Helpers: `sourceCoverImageUrl`, `sourceAvatarImageUrl`
- `/login`, `/logout`, `/oauth/callback` → `src/auth/router.tsx`

### `src/routes/pages.tsx` (mounted at `/`)

- `/home` → `src/pages/home.tsx` — authenticated home (redirects to `/login` if no profile)
- `/feed` → `src/pages/feed.tsx` — activity feed (friends/all/tracking, paginated 25/page)
- `/app` → `src/pages/app.tsx` — iOS app landing
- `/import` → `src/pages/import.tsx` — CSV import page, SSE progress
- `/search` → `src/pages/searchResults.tsx` (zValidator query `q`/`page`/`lang`)
- `/explore` → `src/pages/explore.tsx` — explore hub (`?lang=`)
- `/explore/genres` → `src/pages/genres.tsx`; `/explore/genres/:genre` → `src/pages/genreBooks.tsx`
- `/explore/authors` → `src/pages/authorDirectory.tsx` (`?lang=`)

**`?lang=` is validated against `getAvailableLanguages`, never passed through** (`resolveLanguage`, `src/utils/getLanguages.ts`). It keys a cached 356k-row aggregate _and_ is in the anon page cache's `ALLOWED_QUERY_PARAMS`, so an arbitrary string is an unbounded KV-cardinality and CPU amplifier. Related: `/explore/authors` used to ignore `lang` entirely while `/explore` linked to it _with_ `lang` and the page cache keyed on it — every language a crawler found became its own cache entry holding byte-identical HTML, each paying its own cold render.

- `/authors/:author` → `src/pages/authorBooks.tsx`
- `/genres`, `/genres/:genre` → 301 redirects to `/explore/genres`
- `/.well-known/atproto-did` → returns DID constant

### `src/routes/profile.tsx` (mounted at `/`)

- `/refresh-books` → re-sync books from PDS (auth)
- `/profile` → redirects to `/profile/:handle`
- `/profile/:handle` → `src/pages/profile.tsx` — profile, shelves, follow counts, lists, genre stats
- `/profile/:handle/image` → redirect to avatar
- `/profile/:handle/stats` → redirect to current year; `/profile/:handle/stats/:year` → `src/pages/readingStats.tsx`

### `src/routes/books.tsx` (mounted at `/books`)

- GET `/:hiveId` → `src/pages/bookInfo.tsx` — book detail. `hiveId` must match `^bk_[A-Za-z0-9]+$`. Stale books (>30d) queued for enrichment; `?force-refresh=true` enriches inline with 15s ceiling
- DELETE `/:hiveId` → delete book from PDS + DB
- POST `/` → add/update book (zValidator form); per-DID `book_lock` KV, 429 if locked. Answers `{ success, userBook: UserBookView }` when the request's `Accept` includes `application/json`, otherwise a 302 back to the book (the no-JS path)
- GET `/:hiveId/comments` → `src/pages/comments.tsx`

### `src/routes/comments.tsx` (mounted at `/comments`)

- POST `/` → create/update buzz; DELETE `/:commentId` → delete buzz

### `src/routes/shelves.tsx` (mounted at `/shelves`)

User book lists ("shelves"). Uses **popfeed** lexicons (`social.popfeed.feed.list`/`.listItem`). Delegates to `src/utils/lists.ts`.

- GET/POST `/new` → create list
- GET `/:handle` → user's shelves; GET `/:handle/:rkey` → single shelf
- GET/POST `/:handle/:rkey/edit`, POST `/:handle/:rkey/delete`
- POST `/add`, POST `/:handle/:rkey/add`, POST `/:handle/:rkey/remove`

### `src/routes/settings.tsx` (mounted at `/settings`)

- GET `/` → `src/pages/settings.tsx` (auth)
- POST `/delete-account` → delete account + revoke OAuth + destroy session
- GET `/sync/password`, POST `/sync/rotate` → KOSync password management
- GET `/sync/documents`, POST `/sync/link` → sync document management

### `src/routes/library.tsx` (mounted at `/library`)

Personal library: ebook uploads, e-reader credentials, sync documents. All auth-required.

- GET `/` → `src/pages/library.tsx`
- POST `/upload` → multipart upload. A **thin adapter** over `uploadPersonalBook` (`src/utils/uploadPersonalBook.ts`) — the same core the XRPC procedure calls. Content-negotiated: JSON for mobile, `302 /library?error=<code>` for browsers (a plain `<form>` can't read a JSON error body, so the reason round-trips as a code `LibraryPage` renders as an alert). **No `bodyLimit()` middleware** — see the upload-core section for why it was the worst memory path in the codebase.
- GET `/covers/:hash` → cover image; GET `/books/:hash/download` → file download (shares `streamPersonalBook` with OPDS)
- GET `/shelves` → JSON shelf list with counts
- GET `/sync/password`, POST `/sync/rotate` → KOSync password (duplicated from settings)
- GET `/sync/documents`, POST `/sync/link`, POST `/sync/dismiss`, POST `/sync/rename`, POST `/sync/delete`

### `src/routes/api.tsx` (mounted at `/api`)

- GET `/user-book?hiveId=` → `{ userBook: UserBookView | null }` for the signed-in viewer. Cookie DID only (`getSessionDid`) — no OAuth restore, it never touches the PDS
- POST `/update-book` → JSON write; returns `{ success, message, userBook: UserBookView }`
- POST `/update-comment` → create/update a buzz on a book

**`UserBookView`** (`src/utils/userBookView.ts`) is the one shape every book-state write returns and the read answers with — the `user_book` row minus `userDid` and the raw PDS `record`, with `owned` as a boolean. It exists so a client can update optimistically and reconcile with what was actually written instead of reloading the page.

- POST `/follow`, `/follow-form`, `/unfollow`, `/unfollow-form`

### `src/routes/rss.ts` (mounted at `/rss`)

- GET `/user/:handle`, `/book/:hiveId`, `/friends/:handle` → RSS 2.0 feeds

### `src/routes/opds.ts` (mounted at `/opds`) — e-reader catalog

Serves personal library to e-readers. Auth via `src/middleware/opds-auth.ts` (HTTP Basic, same derived password as KOSync). **Dual-format**: OPDS 1.2 XML or 2.0 JSON based on `Accept` header.

- GET `/` → root navigation feed
- GET `/all`, `/shelves/:id`, `/search/results` → acquisition feeds (paginated at 24)
- GET `/search` → OpenSearch description. Accepts both `q` and `query` params.
- GET `/books/:hash/download/{name}.ext`, `/books/:hash/cover`

**The trailing name is ignored by the route** — the content hash identifies the
file and `personal_book.format` decides what we serve. It is a _required_
segment rather than an optional suffix, and there is deliberately no name-less
or `/download.ext` fallback: readers follow the href out of the feed on each
sync rather than storing it, so there is no older spelling to keep alive.

The name is there because clients dispatch on the URL, not the Content-Type:
CrossPoint's OPDS parser scores an acquisition link higher when its href
contains `.epub` (`lib/OpdsParser/OpdsParser.cpp`), Kobo's built-in browser uses
the extension alone, and anything that falls back to the last path segment for a
filename gets a real title instead of the word `download`.

**`canonicalDownloadFilename` (`src/utils/downloadFilename.ts`) is the one
source of that name**, and it is deliberately used in two places: the URL
segment and the _plain_ `filename` in `Content-Disposition`. A client that reads
the header and one that scrapes the URL then agree byte for byte. It reduces to
`[A-Za-z0-9._-]` so it needs no percent-encoding anywhere (which also means it
cannot emit a `/` into the path), folds Latin diacritics rather than dropping
the word, and falls back to `book` for scripts with no ASCII form — `filename*`
is what carries the real name for those.

**The acquisition rel is `.../acquisition/open-access`, not the bare
`.../acquisition`.** The bare form is the _generic_ relation — it says only that
some acquisition is possible, leaving a strict reader entitled to wait for an
`indirectAcquisition` that never comes. Every client that accepts the generic
form accepts this one, because they all substring-match the
`opds-spec.org/acquisition` prefix.

**Feed links are built from the request's own origin** (`requestOrigin`, honouring
`x-forwarded-proto`/`x-forwarded-host`), not `PUBLIC_URL` — a reader that reached us on one
hostname keeps following that hostname through pagination and search.

**The acquisition (download) link is the one exception**: `OPDS_DOWNLOAD_BASE_URL`, when set,
replaces its scheme+host (`downloadOrigin`), leaving `/opds/books/{hash}/download` untouched.
That exists so an e-reader's multi-MB transfer can go straight at the app instead of through
whatever proxies the public host — the redirect-through-Cloudflare arrangement it replaced was
producing HTTP/2 stream resets mid-download. Only the download moves; feed, nav and cover links
stay on the requested host, and Basic credentials are per-request so the reader re-sends them to
the download host unchanged. Unset means unchanged behaviour, and the download origin must serve
the same `/opds` router with the same auth.

### `src/routes/og.tsx` (mounted at `/og`) — OG images

- `/marketing`, `/book/:hiveId`, `/profile/:handle`, `/profile/:handle/stats/:year`, `/author/:author`, `/genre/:genre`, `/app` → `image/webp`

Failed renders serve `public/og-fallback.png` at 200, never 500. `renderOnce` deduplicates concurrent requests for the same card. **No server-side OG cache** — Cloudflare is the cache. Do not add one without measuring the repeat rate (historically ~4%).

### `src/routes/sync/kosync.ts` (mounted at `/kosync`) — KOReader sync

Auth: `x-auth-user` (handle) + `x-auth-key` (md5 of HMAC-derived password). Progress stored in `sync_document`, bridged to `user_book.bookProgress`. Deferred PDS writes queued in KV and flushed when a session agent is available.

- POST `/users/create` → 403 (directs to BookHive Settings)
- GET `/users/auth` → validate credentials
- PUT `/syncs/progress` → push progress; GET `/syncs/progress/:document` → pull progress
- GET `/syncs/documents` → list all synced documents

**A KOSync `document` id is not necessarily a content hash.** KOReader's
checksum method is a user setting: `BINARY` (the default) is
`koreaderPartialMD5` over the file, but `FILENAME` is plain `md5(basename)`, and
users switch to it precisely because their files are _not_ byte-identical across
devices. Matching only `documentHash = personal_book.contentHash` therefore
never fired for any of them. `SAME_BOOK_FILE` (`src/utils/syncMatching.ts`) is
the one predicate for "same book" — content hash, filename hash, or normalized
filename — and it is used as a **correlated subquery, never a join**, because a
document can match several files (and vice versa) and a join fans that out into
duplicate rows that also break `getPersonalLibrary`'s pagination.

Separately, the payload may carry `metadata: { filename, title, authors }`
(KOReader PR #15306, merged 2026-04-29 — its "Send document metadata" toggle
**defaults off**, so most KOReader users still send none of it; CrossPoint sends
it). Two non-obvious things about that object, each of which silently matches
nothing if you assume otherwise:

- **`authors` is newline-separated**, not comma- or tab-separated. It is
  `doc_props.authors`, one of the three props KOReader's metadata editor opens
  with `allow_newline = true`. (Three separators are in play across the app:
  newline from KOReader, **comma** in `personal_book.authors` from `parseBook`,
  tab in `hive_book.authors`.)
- **`title` may itself be a filename.** It is `doc_props.display_title`, defined
  as `props.title or splitFileNameType(filepath)` — so any document with no
  embedded title sends the filename stem, dashes and all. `matchSyncDocument`
  runs the client's `title` through the filename parser for that reason.

**The routes call `matchSyncDocumentForUser`, not `matchSyncDocument`.** With
both KOReader defaults in force — BINARY checksum, `send_metadata` off, which is
most users — the entire request identifies the book as one partial-MD5 hash and
nothing else, so matching the _payload_ is hopeless no matter how good the tiers
get. But that hash is `personal_book.contentHash`: if the user uploaded the
file, we already parsed real title/author metadata out of the ebook at upload
time and may already have resolved it to a book.
`matchSyncDocumentForUser` finds the file first, inherits its `hiveId`, else
matches on the file's own metadata, and writes the result back onto the file
(plus `user_book.owned`). `uploadPersonalBook` already pushes a link the other
way when the document exists first; this covers the opposite ordering.

`matchSyncDocument` itself runs three tiers, and the invariant across all of
them is that **a wrong link is worse than no link**: it writes progress onto a
book the user isn't reading and mirrors it to their PDS, while a miss just
leaves the document for them to link by hand.

1. Exact `hive_book.id` hash of the client's title+author.
2. Exact id hash of title/author pairs parsed out of the filename. Both
   orderings of an `A - B` split are tried; that is safe _because_ it resolves
   against the catalogue, so a wrong guess hashes to an id that does not exist.
3. Fuzzy. Candidates come from `hive_book_fts`, searched by **author** as well
   as by title — FTS matches phrases, so a title search alone can never reach
   "The Hitchhiker's Guide" from "Hitchhikers Guide", whereas an author's name
   is spelled the same either way and their books can then be compared in JS.
   Acceptance is `titlesEquivalent` (equal content-word sets, gated **both**
   ways — one-way containment would accept "Dune" as "Dune Messiah") plus an
   agreeing author. With no author signal anywhere, only a title that names
   exactly one book is accepted.

Do not gate any of this on title/author being present — that gate is what made a
filename-only client unmatchable in the first place.

### Shared route helpers

`src/routes/lib.ts` — `cacheControl`, `searchBooks`, `ensureBookIdentifiersCurrent`, `refetchBooks`, `refetchBuzzes`, `refetchLists`, `syncFollowsIfNeeded`.

## Server-Side Pages (`src/pages/`)

Each file exports a Hono JSX component rendered server-side.

| File                  | Renders                                            |
| --------------------- | -------------------------------------------------- |
| `layout.tsx`          | HTML shell — meta tags, assets, `<head>`/`<body>`  |
| `navbar.tsx`          | Top nav bar with user menu, search mount point     |
| `simple-navbar.tsx`   | Simplified nav bar variant                         |
| `sidebar.tsx`         | Sidebar layout component                           |
| `home.tsx`            | Authenticated home page                            |
| `marketing.tsx`       | Marketing landing (signed-out only; `/` redirects) |
| `searchResults.tsx`   | Search results                                     |
| `bookInfo.tsx`        | Book detail                                        |
| `profile.tsx`         | User profile + shelves                             |
| `shelves.tsx`         | Book shelves view                                  |
| `comments.tsx`        | Comments/reviews                                   |
| `feed.tsx`            | Activity feed                                      |
| `readingStats.tsx`    | Reading stats by year                              |
| `settings.tsx`        | Account settings                                   |
| `explore.tsx`         | Explore hub                                        |
| `genres.tsx`          | Genre directory                                    |
| `genreBooks.tsx`      | Books by genre (paginated, sortable)               |
| `genreEmoji.ts`       | Genre → emoji mapping                              |
| `authorBooks.tsx`     | Books by author (paginated)                        |
| `authorDirectory.tsx` | Author directory                                   |
| `import.tsx`          | CSV import page                                    |
| `library.tsx`         | Personal library                                   |
| `login.tsx`           | Login form                                         |
| `signup.tsx`          | Sign up form                                       |
| `app.tsx`             | iOS app landing                                    |
| `privacy-policy.tsx`  | Privacy policy                                     |
| `terms.tsx`           | Terms of service (`/legal`)                        |
| `pds.tsx`             | PDS info page                                      |
| `error.tsx`           | Error page                                         |

Page utilities: `src/pages/utils/script.ts` (inline JS helper), `src/pages/utils/buildUrl.ts`.

**`Layout` always needs `url={c.req.url}`.** It resolves `url` from `useRequestContext()` only as
a fallback, and that throws for the ~14 routes that render via `c.html(<Layout …>)` instead of
`c.render(…)` — there is no jsx-renderer context on those. When it throws, `url` silently falls
back to the hardcoded `https://bookhive.buzz`, so `<link rel="canonical">`, `og:url` and the
JSON-LD `SearchAction` all pointed at the site root. `/privacy-policy` and `/legal` were live in
production telling crawlers their canonical URL was the homepage. Every direct call site now
passes `url` explicitly; keep doing that when adding one. `og:image`/`twitter:image` are
absolutised against `url` inside `Layout` (crawlers don't resolve relative image URLs), and the
JSON-LD block uses `new URL(url).origin` because it describes the site, not the page.

### Raster images in `public/`

Page images are `<picture>` with a WebP `<source>` and the original as the `<img>` fallback.
Regenerate with `cwebp -preset picture -q 78..82 -m 6 [-resize <w> 0] in -o out.webp` — **always
pass `-preset picture`**; the default preset is far more conservative (it gave 419 KB where
`picture` gave 164 KB on the same input at the same quality). Lossless (`-z 9`) is not worth
trying on anything sourced from a JPEG: it preserves the existing compression noise and came out
larger than the JPEG. Size the WebP to ~2x the CSS slot, not to the source's intrinsic size.

| Asset                                                       | Serves                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `hive-{768,1280}.webp` + `hive.jpg`                         | Marketing hero. The LCP element — `fetchpriority="high"`, intrinsic `width`/`height`, never lazy |
| `screenshots/{home-screen,book-info,comment}.webp` + `.png` | `/app` phone mockups                                                                             |
| `full_logo-384.webp` + `full_logo.jpg`                      | Login/signup logo (rendered at 192px)                                                            |

**Do not convert these**, each for a specific reason:

- `full_logo.jpg` must stay — it is also the default `og:image` and the OAuth client `logo_uri`
  in `src/auth/client.ts`, both consumed by third parties that may not decode WebP.
- `og-fallback.png` — OG/Twitter card images; crawler WebP support is unreliable.
- `android-chrome-{192,512}.png` — referenced by `public/site.webmanifest` with an explicit
  `"type": "image/png"`; changing the format means editing the manifest and risking PWA install.
- `apple-touch-icon.png`, `favicon*.png`, `favicon.ico` — fixed-format platform requirements.
- `reading.png` — only used by `README.md` / `app/README.md`, never served.

The other 13 `public/screenshots/*.png` (5.6 MB — the directory holds 16, three of which are the
`<img>` fallbacks above) are referenced nowhere in the codebase; they
look like App Store listing assets (light/dark and `-16` variants), so they are kept as-is.

### Shared Page Components (`src/pages/components/`)

| File                       | What                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `book.tsx`                 | Book card component                                                      |
| `BookCard.tsx`             | Composable book card (`dense` takes `showAuthor` for search/genre grids) |
| `buzz.tsx`                 | Buzz/comment display                                                     |
| `BookReview.tsx`           | Book review form/display                                                 |
| `EditableLibraryTable.tsx` | Library table with inline editing                                        |
| `ProfileHeader.tsx`        | Profile header with avatar/stats                                         |
| `LanguageSelect.tsx`       | Language picker                                                          |
| `modal.tsx`                | Modal dialog (CSS-based)                                                 |
| `fallbackCover.tsx`        | Placeholder book cover                                                   |
| `AtTags.tsx`               | AT Tags `<meta name="at:...">` builder                                   |
| `cards/`                   | `Card`, `CardActions`, `StarDisplay`, `UserBlock`                        |

**AT Tags** (`AtTags.tsx`): emits `<meta>` tags declaring ATProto records/identities a page maps to. Built with hono's `html` template (not JSX `<meta>`) because hono/jsx dedupes by `name`. Routes pass tags via `c.render(..., { atTags })`.

## Client-Side Components (`src/client/`)

6 hydration islands, mounted in `src/client/index.tsx`:

| Component        | Mount Point                                                               | File                                              |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| `SearchTrigger`  | `#mount-search-box`                                                       | `src/client/components/SearchBox.tsx`             |
| `SearchPalette`  | `#mount-search-palette`                                                   | `src/client/components/SearchPalette.tsx`         |
| `BookIslands`    | `#mount-book-actions` (+ `#mount-book-timestamp`, `#mount-book-activity`) | `src/client/components/book/index.tsx`            |
| `ImportTableApp` | `#import-table`                                                           | `src/client/components/import/ImportTableApp.tsx` |
| `LibraryTable`   | `#mount-library-table`                                                    | `src/client/components/LibraryTable.tsx`          |
| `LibraryManager` | `#mount-library-manager`                                                  | `src/client/components/LibraryManager.tsx`        |

**`BookIslands`** (`src/client/components/book/`) is the signed-in half of `/books/:id`: status
and owned in the hero card, the timestamp line, and the whole "Your Activity" card. One
`createUserBookStore` per page holds `{ view, confirmed, pending, error }` and the three
components subscribe with `useSyncExternalStore` — they can't share a root, being cards apart.
Props are JSON in `#mount-book-actions[data-props]`, built in `src/pages/bookInfo.tsx`.

- **Changes are optimistic and replaced by the server's `UserBookView`.** `applyOptimistic`
  mirrors `inferBookStatusAndDates`, so it must be updated whenever that is: a payload asserting
  no status must leave status and dates alone, or the frame flickers back.
- **Writes are serialised**, and a response never overwrites `view` while later ones are queued.
  A delete blocks writes for its whole duration — the server re-creates the record otherwise.
- **The server-rendered forms inside the mounts are the pre-hydration paint** and all a no-JS
  visitor gets, so they keep their own inline `<Script>` handlers. Don't delete those again.

`StarRating` is no longer mounted on its own; the activity panel renders it, and it follows its
`initialRating` prop so a rollback or reconcile shows in the stars.

`LibraryManager` sub-components in `src/client/components/library/`: `AnchoredMenu.tsx`, `ShelfTabs.tsx`, `PersonalBookCard.tsx`, `SyncDocumentSections.tsx`, `types.ts`.

**`AnchoredMenu`/`MenuItem`/`MenuConfirm`** are the house dropdown: no state, `peer` checkbox + `<form>` reset. Don't switch to Popover API or CSS anchor positioning (both tried and reverted). All library menus use it.

Other client components: `bookActions.tsx`, `ProgressBar.tsx`.
Client hooks/utils: `useSearchBooks.ts`, `useDebounce.ts`, `icons.tsx`, `debounce.ts`, `throttle.ts`.

## Data Layer

### Database (`src/db.ts`)

SQLite via Kysely. Schema + all migrations (001–025) in one file. `createDb` sets WAL/perf PRAGMAs. `mmap_size` defaults to 0 (see `DB_MMAP_SIZE` in `src/env.ts`). Kysely talks to `bun:sqlite` through `src/bun-sqlite-kysely.ts`, which rewrites `begin` to `BEGIN IMMEDIATE` (deferred transactions fail with `SQLITE_BUSY_SNAPSHOT` across cluster processes).

That wrapper also decides `statement.reader`, which is how Kysely picks `all()` (rows) over `run()` (changes). **It asks SQLite — `stmt.columnNames` is empty for anything that doesn't produce rows — rather than pattern-matching the SQL text.** The old regex was anchored on a leading `SELECT`, so `WITH cte AS (…) SELECT …` was classified as a write and Kysely got **zero rows with no error of any kind**; the author-directory cover lookup is a window function over a CTE and silently returned nothing. `columnNames` also gets the converse right, which a regex struggles with: `WITH cte AS (…) INSERT INTO …` is not a reader.

| Table                 | Purpose                   | Key columns                                                                                                                                                                                              |
| --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_book`           | User's book records       | uri (PK), userDid, hiveId, title, authors, status, **stars** (not `rating`), review, startedAt, finishedAt, **owned** (bool), bookProgress, previousReads (JSON), **record** (JSON, mig 025 — see below) |
| `hive_book`           | Canonical book data       | id (HiveId, PK), title, authors (**tab-separated**), cover, thumbnail, description, rating, ratingsCount, series, meta, enrichedAt, enrichAttempts, enrichFailedAt, identifiers, hiveBookAtUri, language |
| `hive_book_genre`     | Genre-to-book mapping     | hiveId, genre (UNIQUE pair). **Genres live ONLY here**                                                                                                                                                   |
| `hive_book_fts`       | FTS5 search index         | External-content FTS5 over `hive_book(title, rawTitle, authors)`, trigger-maintained. Never written directly. **Rebuilt after VACUUM** — see below                                                       |
| `hive_book_author`    | Author-to-book mapping    | hiveId, author, position (PK hiveId+author). Trigger-maintained. `position = 0` = first author                                                                                                           |
| `book_id_map`         | ISBN/Goodreads cross-refs | hiveId (PK), isbn, isbn13, goodreadsId, updatedAt                                                                                                                                                        |
| `buzz`                | Comments on books         | uri (PK), userDid, hiveId, **comment**, bookUri, parentUri, createdAt                                                                                                                                    |
| `user_follows`        | Cached follow graph       | userDid, followsDid, followedAt, syncedAt, **isActive**                                                                                                                                                  |
| `book_list`           | User-created book lists   | **uri (PK, AT URI)**, userDid, name, description, ordered, tags, createdAt                                                                                                                               |
| `book_list_item`      | Items in a book list      | **uri (PK, AT URI)**, userDid, **listUri**, hiveId, position                                                                                                                                             |
| `sync_document`       | E-reader sync progress    | id (PK), userDid, provider, documentHash (UNIQUE per user+provider), hiveId (nullable), filename, **filenameKey**, title, authors, progressData (JSON)                                                   |
| `enrich_queue`        | Pending Goodreads enrich  | **hiveId (PK — the dedupe)**, **enqueuedAt** (age ceiling; survives re-enqueue), attempts, nextAttemptAt, claimedAt, lastError                                                                           |
| `personal_book`       | Uploaded ebook files      | id (PK, autoincrement), UNIQUE (userDid, contentHash), filename, **filenameHash**, **filenameKey**, title, authors, format, hiveId (nullable), **sizeBytes**                                             |
| `personal_shelf`      | User's personal shelves   | id (PK, autoincrement), userDid, name, description                                                                                                                                                       |
| `personal_shelf_item` | Books in personal shelves | shelfId, **personalBookId** (UNIQUE pair) — the row id, not the content hash                                                                                                                             |

Notes: `book_list*` are keyed by AT URI, not numeric ids. `NO_HIVE_MATCH` sentinel (`bk_none`) on `sync_document.hiveId` means the user dismissed the match — read paths must surface as `{ hiveId: null, dismissed: true }`. `enqueueEnrichmentBatch` filters books with recent `enrichAttempts`/`enrichFailedAt` internally (7d cooldown).

**The main DB is VACUUMed only when there is something to reclaim**
(`src/context.ts`), gated on **its own** `freelist_count / page_count` against
the shared `VACUUM_FREELIST_RATIO` (0.25) — not on anything about the KV.
Measured against production (356,675 books, 1.62 GB) a VACUUM there costs
**22.3s and frees nothing**: `freelist_count` is 0, because this file is
essentially append-only. Keep it conditional; don't restore the unconditional
VACUUM without re-reading `freelist_count` first.

The KV (`vacuumKvIfBloated`) is the delete-heavy file — 1.94 GB holding 34.7 MB
of live rows — and is gated slightly differently: it VACUUMs whenever the ratio
is exceeded **or** `auto_vacuum` is not yet INCREMENTAL, because switching a
file to incremental auto-vacuum only takes effect through a VACUUM. In practice
that means one unconditional VACUUM the first time this ships, then bloat-driven
after that, with `incremental_vacuum` on the 15-minute sweep in between.

**`hive_book_fts` is rebuilt when that VACUUM does run** (`src/context.ts`). It is
an external-content table keyed by `hive_book`'s _implicit_ rowid — `id` is
TEXT, so it is not an INTEGER PRIMARY KEY alias — and SQLite documents that
VACUUM "may change the ROWIDs of entries in any tables that do not have an
explicit INTEGER PRIMARY KEY". If it ever does, every search result silently
points at the wrong book. Measured on SQLite 3.51 rowids are preserved, and
FTS5's own `'integrity-check'` does **not** detect this class of desync
(verified against a deliberately shifted content table), so there is no cheap
way to notice the day that changes. `'rebuild'` is ~1s at 356k rows, once, on
the primary worker inside the startup barrier where VACUUM already runs.

### KV Cache (`src/sqlite-kv.ts`)

SQLite-backed unstorage. Mounts: `search:` (in-memory LRU), `profile:`, `identity:`, `follows_sync:`, `auth_session:`, `auth_state:`, `book_lock:`, `sync_pending:`, `sync_token:`, `page:` (anon page cache). VACUUMed on startup by primary worker; incremental vacuum on 15-min sweep.

### Key Utilities (`src/utils/`)

| File                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getBook.ts`            | Book record CRUD against user's PDS. `updateBookRecord` is the interactive write — see "The book write path" below                                                                                                                                                                                                                                                                                                            |
| `userBookStore.ts`      | `user_book` row read/upsert + `recordFromUserBook` (local merge source). Apart from `getBook.ts` so the follow-up can import it without a cycle                                                                                                                                                                                                                                                                               |
| `bookRecordWrite.ts`    | CAS write of a book record (`putRecord` + `swapRecord`, `createRecord` for new). There is deliberately no unguarded variant                                                                                                                                                                                                                                                                                                   |
| `userBookFollowUp.ts`   | Deferred cover-blob upload + `hiveBookUri` patch after the response; CAS'd, and on conflict re-read and re-applied (3 attempts) — see the write-path note. Outcomes in `bookhive_user_book_follow_up_total`                                                                                                                                                                                                                   |
| `userBookView.ts`       | `UserBookView` + `toUserBookView` — the wire shape for book-state reads/writes                                                                                                                                                                                                                                                                                                                                                |
| `getProfile.ts`         | Profile fetching from Bluesky                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getFollows.ts`         | Follow graph sync                                                                                                                                                                                                                                                                                                                                                                                                             |
| `enrichBookData.ts`     | Goodreads enrichment (semaphore-bounded, 45s deadline)                                                                                                                                                                                                                                                                                                                                                                        |
| `enrichQueue.ts`        | `enrich_queue` producer + primary-worker drain, and the `retry`/`defer`/`dead` accounting. The `exhausted` gauge/heartbeat counts `hive_book.enrichFailedAt` inside the cooldown, **not** queue rows at MAX_ATTEMPTS — those are deleted as they exhaust, so that read was always 0. `deferred` counts books parked on something that isn't their fault; it replaced `circuit_open` as the signal that fetching is in trouble |
| `semaphore.ts`          | Async concurrency limiter + `withTimeout`                                                                                                                                                                                                                                                                                                                                                                                     |
| `circuitBreaker.ts`     | Three-state breaker — **`auth/restore-guard.ts` only.** Right when refusing is cheaper for a waiting user than failing; wrong for scraping, where the queue can defer instead. See the note under Scrapers                                                                                                                                                                                                                    |
| `bookIdentifiers.ts`    | ISBN/ID normalization + persistence                                                                                                                                                                                                                                                                                                                                                                                           |
| `bookProgress.ts`       | BookProgress serialization                                                                                                                                                                                                                                                                                                                                                                                                    |
| `readThroughCache.ts`   | KV read-through with TTL + optional `revalidateAfter` (stale-while-revalidate). Prefer SWR for anything expensive — a plain TTL makes every expiry a blocking recompute on a request path. The entry is stamped **after** the fetch resolves, so a slow fetch isn't born stale                                                                                                                                                |
| `authorStats.ts`        | `getAuthorStats` / `getFeaturedAuthors` — the `/explore` author aggregates, SWR-cached inside the helper, `INDEXED BY idx_hive_book_stats`. Featured is a strict prefix of the directory list, not its own query                                                                                                                                                                                                              |
| `exploreGenres.ts`      | `getTopGenres` — same, for genres. Only joins `hive_book` when a language is given                                                                                                                                                                                                                                                                                                                                            |
| `csv.ts`                | Goodreads/StoryGraph CSV parsers                                                                                                                                                                                                                                                                                                                                                                                              |
| `lists.ts`              | Book list (shelf) CRUD against PDS                                                                                                                                                                                                                                                                                                                                                                                            |
| `readingStats.ts`       | Reading stats aggregation by year                                                                                                                                                                                                                                                                                                                                                                                             |
| `imageProxy.ts`         | imgproxy signing + proxy helper                                                                                                                                                                                                                                                                                                                                                                                               |
| `personalLibrary.ts`    | Personal library paths, `streamPersonalBook`, `getStorageUsage`/`getStorageQuota`                                                                                                                                                                                                                                                                                                                                             |
| `uploadPersonalBook.ts` | **The one** "put this ebook in this user's library". Both `POST /library/upload` and the XRPC procedure are thin adapters over it — see below                                                                                                                                                                                                                                                                                 |
| `bookMetadata/`         | Ebook metadata parsing (epub, mobi, fb2, cbz, cover extraction, KOReader hash)                                                                                                                                                                                                                                                                                                                                                |
| `bookMeta.ts`           | Book metadata utilities                                                                                                                                                                                                                                                                                                                                                                                                       |
| `syncMatching.ts`       | KOReader document → BookHive book matching (3 tiers, see below); `NO_HIVE_MATCH` sentinel; `SAME_BOOK_FILE`                                                                                                                                                                                                                                                                                                                   |
| `filenameMatching.ts`   | Filename-derived identity: `koreaderFilenameHash`, `filenameKey`, `filenameBookCandidates`, `titlesEquivalent`, `authorsMatch`                                                                                                                                                                                                                                                                                                |
| `bookMatching.ts`       | Fuzzy title scoring primitives (`similarityScore`, `contentWords`, `contentWordsMatch`), ported from MIT-licensed shelfcheck                                                                                                                                                                                                                                                                                                  |
| `syncBridge.ts`         | Bridge e-reader progress → user_book + queue PDS write                                                                                                                                                                                                                                                                                                                                                                        |
| `ftsQuery.ts`           | FTS5 MATCH expression builder                                                                                                                                                                                                                                                                                                                                                                                                 |
| `importBook.ts`         | Import a single book record                                                                                                                                                                                                                                                                                                                                                                                                   |
| `authorMatching.ts`     | Author name matching                                                                                                                                                                                                                                                                                                                                                                                                          |
| `manifest.ts`           | Vite manifest → asset URLs                                                                                                                                                                                                                                                                                                                                                                                                    |
| `xml.ts`                | XML utilities                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Other                   | `getLanguages.ts`, `catalogBookService.ts`, `deleteAccount.ts`, `dbExport.ts`, `generateInitialsAvatar.ts`, `htmlToText.ts`, `batchTransform.ts`, `lazy.ts`, `hiveBookGenres.ts`, `ensureBookCataloged.ts`, `uploadImageBlob.ts`                                                                                                                                                                                              |

### The book write path (`src/utils/getBook.ts` → `updateBookRecord`)

Every status click, rating and review edit goes through here, so it is **one PDS round-trip**.
It used to be two to four plus a scrape. Four things keep it correct:

- **The merge source is the local row, not the PDS.** `user_book.record` (migration 025) holds
  the last record seen, because it carries three fields the columns don't — `cover`,
  `identifiers`, `hiveBookUri` — and merging without them strips them. `recordFromUserBook`
  rebuilds it with **columns winning**: KOSync progress and `owned` from an upload reach the row
  before the PDS. Every full-record writer sets the column; a null one falls back to `getRecord`.
  The wide event says which: `book_merge_source: local | pds | pds_after_conflict`.
- **The write is compare-and-swapped** on the cid we merged against (`bookRecordWrite.ts`). On
  `InvalidSwap` the record is re-read once and re-merged. `applyWrites` only offers `swapCommit`
  (the whole repo), hence `putRecord`.
- **Partial payloads must not invent state.** The island sends only what changed, so
  `inferBookStatusAndDates` reads status _and_ dates off the record too: a missing status is not
  "no status" (that downgraded finished books on a date edit), and a date is restamped only when
  the book actually enters that status (else a rating save rewrote the user's start date).
- **Cover and catalogue link are patched in after the response** (`userBookFollowUp.ts`), CAS'd
  on the cid the request wrote. **A lost CAS race is re-read and re-applied (3 attempts), not
  dropped** — losing to the user's own next edit is the _common_ case (first add, then a rating
  click while the cover uploads), and nothing ever re-supplies the cover: the island sends no
  `coverImage` and the merge builds from a record without one, so a dropped patch lost the
  cover for good. The blob upload/scrape run once; only the write retries, patching only the
  fields the fresh record still lacks. The row update stays guarded on the cid that was
  swapped on, so a row that moved on is left alone (the next write CAS-heals it). It writes
  only `cid`/`indexedAt`/`record` — replaying the whole row reverted column-only writes.
  Outcomes land in `bookhive_user_book_follow_up_total`; the request's wide event is gone by
  then.

### The upload core (`src/utils/uploadPersonalBook.ts`)

**There is exactly one upload implementation. Do not add a second.** There used
to be two — the live multipart route and a `processBookUpload` in the XRPC
router whose own doc comment claimed to be the shared core — and they drifted in
four ways (cover validation, sync matching, `sync_document.hiveId` writeback,
empty-string handling) before anyone noticed. Both routes are now thin adapters.

**The step order is the design, not an accident**, and each step is where it is
for a measured reason:

1. Reject on the _declared_ size and against the quota — before a byte is read.
2. `writeCapped` streams the body to `{libraryDir}/.tmp/*.part`, capping as it
   goes. The memory bound is the sink's **1 MB `highWaterMark`** — awaiting each
   write is the backpressure signal, so a 100 MB body costs 1 MB of buffer
   rather than 100 MB. This is what replaced `bodyLimit()`, which only
   short-circuits on `Content-Length`: given a chunked body it drained the whole
   stream into an array and rebuilt the Request, so a compliant 100 MB chunked
   upload was buffered there **and again** by `formData()`.
3. `detectFormat` off a **4 KB head** (it reads ≤512 bytes, plus 60–68 for MOBI).
4. `koreaderPartialMD5File` reads **twelve 1 KB windows** — the hash never needed
   the whole file; the buffer was incidental to how the old path worked.
5. **Duplicate check before the parse**, so a re-upload allocates nothing.
   `src/routes/library.test.ts` leans on this ordering to exercise the duplicate
   path without touching the library directory.
6. `parseBook` + `prepareCover` in a **single-shot Worker** (`parseBookInWorker`,
   `src/workers/parse-client.ts` → `parse-worker.ts`), gated by `parseSemaphore`.
   These are the only whole-file, CPU-bound steps — `parseBook` holds the full
   buffer (fflate reads a ZIP's central directory from the end of one contiguous
   array) and `prepareCover` rasterizes synchronously — so running them inline
   stalled the request process's event loop; a Worker per upload moves both off
   it. The file is read inside the Worker from the temp path, so nothing large
   crosses the thread boundary. `UPLOAD_PARSE_CONCURRENCY` (2) still bounds
   concurrency — now the number of **live Workers**, hence the native memory
   across them — and it is **per process**: at the deployed `WEB_CONCURRENCY=3`
   the ceiling is `2 × 3 × 100 MB ≈ 630 MB`, against a previously _unbounded_
   ~200–400 MB per in-flight upload. The Worker is terminated on every path
   (reply, error, or the 60s deadline); the semaphore sheds excess as `busy`
   (503) rather than spawning Workers without limit.
7. Cover gated on `prepareCover`, always (rasterizes SVG, then validates). `coverPath IS NOT NULL` is the only
   signal driving `coverUrl` on the web library, the OPDS feed and the XRPC book
   view, so an unvalidated cover is a dead URL and a blank box in all three.
8. **The quota `SUM` is evaluated inside the INSERT's `WHERE`.** SQLite
   serialises writers, so this is exact — two concurrent uploads cannot both
   observe the pre-insert total. A per-process mutex would not have worked:
   production is three independent processes against one file. The statement
   also carries `ON CONFLICT (userDid, contentHash) DO NOTHING`, so two uploads
   of the same file racing past the duplicate check report `duplicate` instead
   of raising a UNIQUE violation; the two zero-row outcomes are told apart by
   re-reading the row.
9. `rename` into place — same filesystem, zero bytes copied. The row commits
   _before_ the bytes move, which beats writing 100 MB and then discovering a
   problem.
10. **Derive an EPUB** for a MOBI/AZW3, after the rename so the converter reads
    the committed file rather than a temp path about to be unlinked. Non-fatal
    in every branch — see below.

### EPUB conversion (`src/utils/convertToEpub.ts`)

Uploads in a format an e-reader may refuse get a derived EPUB, and **every
download path serves the derivative when one exists**. That is what makes a MOBI
usable from CrossPoint at all: its OPDS parser requires
`type == "application/epub+zip"` **exactly** (`lib/OpdsParser/OpdsParser.cpp`),
so a MOBI entry is invisible to it otherwise.

- **The original is never deleted.** Conversion is lossy — boko drops
  stylesheets while leaving `<link>` references to them, so output fails
  `epubcheck` though every reader opens it — and a derived file must stay
  re-derivable.
- **`servedRepresentation()` (`src/utils/personalLibrary.ts`) is the single
  source of "which bytes and which type".** `streamPersonalBook` and the OPDS
  feed builder both use it; a feed advertising `x-mobipocket` for a link that
  returns an EPUB is exactly the mismatch a reader silently refuses to act on.
- **The ETag must differ between the two representations.** `contentHash` hashes
  the _original_, so serving the EPUB under it tells a client holding the MOBI
  that it is already current, and it keeps the stale file forever. Converted
  books serve `"{contentHash}-epub"`.
- **The quota is unchanged.** `epubSizeBytes` is tracked but excluded from
  `SUM(sizeBytes)`, the same way stored covers already are — so the quota keeps
  meaning "bytes the user uploaded". Budget disk accordingly.
- **It runs in a single-shot Worker** (`convert-worker.ts`), because
  `boko.convert` is a _synchronous_ WASM call holding the whole input and whole
  output at once. On the request thread that is a stalled event loop plus
  ~200 MB of live buffers in a process serving a third of all traffic. Only
  paths cross the boundary; the worker reads and writes the files itself.
- **`azw3` is tried before `mobi`,** and that is a quality choice, not
  redundancy. `personal_book.format` is `"mobi"` for `.mobi`/`.azw`/`.azw3`
  alike, but a dual-format Kindle file holds both an old MOBI 6 part and a
  modern KF8 part and boko converts whichever you name. Measured on Pride and
  Prejudice: `azw3` gives 76 chapters / 246 files, `mobi` gives 64 / 234.
- **FB2 and CBZ are the remaining gap** — boko reads neither, so they still
  reach e-readers in their own format.

**boko is GPL-3.0-or-later and BookHive is MIT.** The WASM module is linked into
our process, which makes the _distributed_ artifact a combined work; this repo
is public and publishes ghcr.io images. That was a deliberate, informed choice.
`vendor/boko/` holds the build, the upstream version, the rebuild recipe and the
GPL text that must travel with the binary — read its README before touching any
of this. The `.wasm` is checked in so a clone needs no Rust toolchain and CI
compiles nothing; `vite.config.ts` copies it next to the bundled worker, because
the glue loads it from its own directory at runtime — a path the bundler cannot
see, whose absence fails at conversion time and looks like a converter bug
rather than a missing file.

Sync-doc linking is **exact first, fuzzy only on a miss**. The XRPC path used to
run `matchSyncDocument` first, which let a title/author guess beat a byte-exact
`documentHash` — wrong, and it paid for up to four FTS queries on the common
path. Newly-linked documents also get their **already-recorded progress
bridged**, which is why the core takes `kv`.

Errors are a **discriminated result, never a throw** — `processBookUpload` threw
`XRPCError` from a util, so a Hono route had to catch an HTTP-shaped exception
and translate it back. Each adapter owns its own status codes; the XRPC mapping
is `uploadErrorFor` in the router, the HTTP one is the `switch` in
`src/routes/library.tsx`.

**Storage quota** is `SUM(personal_book.sizeBytes)` per user, derived rather than
counted: the quota itself bounds the row count (~700 rows at 2 GB over a ~3 MB
median epub), `idx_personal_book_user_size` (migration 023) makes it index-only,
and a derived total cannot drift. A counter would need a backfill, decrements in
both delete paths and a repair job — and `removeBookDir` is best-effort, so a
failed `rm` after a row delete would under-report forever while the disk filled.
**The quota counts book bytes only; stored covers are extra.** Measured on
production they add **~12%** on top (13.4 MiB of covers against 110.4 MiB of
books), so a user at a 2 GB quota occupies closer to 2.25 GB of disk — size the
volume accordingly rather than assuming the quota is the ceiling.
Over-quota is **413** (not 507, which proxies retry as a server fault; not 403,
which reads as auth) with `{error, code, usedBytes, quotaBytes}` — the iOS app
renders `payload.error` verbatim for any non-2xx, so already-installed builds
show the message with no update shipped.

**Cover extraction is two-pass** (`bookMetadata/epub.ts`, `cbz.ts`). fflate's
`UnzipFileFilter` returning `false` still walks the central directory, so pass 1
indexes every image's name and `originalSize` for free and pass 2 inflates
exactly the chosen one, gated on `MAX_COVER_BYTES`. Both parsers used to inflate
_every_ image in the archive to keep one — a 100 MB CBZ decompressed ~100 MB of
pages to keep page 1.

**An SVG cover is a composition, not a wrapper — it must be rasterized.**
`prepareCover` (`bookMetadata/cover.ts`) is the one gate between "the parser
found something" and "we store a cover", and it renders SVG through
`@resvg/resvg-js` before validating. Standard Ebooks — one of the largest
sources of public-domain EPUBs — ships every cover as an SVG holding the artwork
in an `<image>` element _plus_ the title and author as ~40 vector `<path>`s over
a translucent band. Both shortcuts lose half the cover, and both were tried:
pulling the embedded base64 raster back out drops the lettering, and rendering
with `@takumi-rs` (already a dependency, so tempting) drops the artwork — it
ignores the embedded `<image>` entirely.

Three things hold this together:

- **Dimension checks use `image-meta`, not `Bun.Image`.** Bun's pipeline rejects
  SVG as an "unrecognised format", which is what made every Standard Ebooks
  upload land with no cover at all. The two agree exactly on every raster
  format; `image-meta` just knows more of them, and parses headers only.
- **The output is JPEG, never SVG.** OPDS clients and e-readers can't be relied
  on to render vector covers, and an SVG served from our own origin is
  script-capable where a JPEG is inert (there is no CSP anywhere in this app).
  Rasterizing at `SVG_RASTER_WIDTH` (700 — the largest a cover is ever displayed
  is ~300 CSS px) then encoding to JPEG turns a 1.1 MB `resvg` PNG into ~77 KB.
- **`@resvg/resvg-js*` is in `traceDeps`** (`vite.config.ts`) alongside
  `@takumi-rs/core*`. Native NAPI bindings never appear in the Rolldown graph,
  and a missing one here does **not** crash — `prepareCover` catches and returns
  null — so an untraced build silently uploads every Standard Ebooks book with
  no cover, which is exactly the bug it was added to fix.

Rasterizing runs inside the parse Worker (step 6), next to the ZIP parse and
under the same `parseSemaphore`, so `UPLOAD_PARSE_CONCURRENCY` bounds all of an
upload's native memory rather than just the file buffer. `resvg` renders
synchronously (~0.5s at width 700, ~2.4s at 1400 — the cost scales with the
square of the width, which is the other reason 700 is the cap); running it on
the Worker rather than the request thread is why that synchronous cost no longer
stalls the event loop. `@resvg/resvg-js` is bundled into the standalone Worker
by `bun build` (its `.node` binding is emitted alongside `parse-worker.js`), the
same way the OG worker ships takumi's.

## Types & Constants

- `src/types.ts` — shared types: `HiveId`, `UserBook`, `HiveBook`, `Buzz`, `BookProgress`, `SearchResult`, `SyncDocumentRow`, etc.
- `src/constants.ts` — book status enums and display maps

## AT Protocol / Bluesky

| File                      | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `src/bsky/ingester.ts`    | Jetstream firehose — ingests book/buzz records (ingester-worker) |
| `src/bsky/id-resolver.ts` | DID/handle resolution with caching                               |
| `src/bsky/bookLookup.ts`  | Book identifier lookup + transformation                          |
| `src/bsky/lexicon/`       | Generated types + validators from lexicon schemas                |
| `src/xrpc/router.ts`      | All `/xrpc/*` methods                                            |
| `lexicons/*.json`         | AT Protocol lexicon definitions (44 files)                       |
| `lex.config.ts`           | Lexicon codegen config (`bun run lexgen`)                        |

**Records**: Books `buzz.bookhive.book`, buzzes `buzz.bookhive.buzz`, lists `social.popfeed.feed.list`/`.listItem`, follows `app.bsky.graph.follow`.

**XRPC queries**: `searchBooks`, `listGenres`, `getBookIdentifiers`, `getBook`, `getProfile`, `getLanguages`, `getExplore`, `getFeed`, `getAuthorBooks`, `getReadingStats`, `getUserLists`, `getList`.

**XRPC list procedures**: `createList`, `updateList`, `deleteList`, `addToList`, `removeFromList`, `reorderList`.

**XRPC personal library queries**: `getPersonalLibrary` (params `limit`/`cursor`/`shelfId`/`q`/`sort`; output carries `storage`), `getPersonalBook`, `getPersonalBookFile`, `getPersonalBookCover`, `listPersonalShelves`, `getSyncProgress`, `listSyncDocuments`.

**Every `getPersonalLibrary` sort ends on `personal_book.id`.** None of the
leading keys are unique: titles and authors collide routinely (a series, an
omnibus, the same book in two formats), and `createdAt` — millisecond-precision
ISO — collides when two uploads commit in the same millisecond. SQLite may order
ties differently between two `LIMIT`/`OFFSET` queries, so without a unique final
key a book appears on two consecutive pages while another never appears at all.
Same reasoning applies to any new sort added here.

**XRPC personal library procedures**: `uploadPersonalBook`, `deletePersonalBook`, `linkPersonalBook`, `unlinkPersonalBook`, `putSyncProgress`, `createPersonalShelf`, `updatePersonalShelf`, `deletePersonalShelf`, `addToPersonalShelf`, `removeFromPersonalShelf`.

**The personal library is fully reachable over XRPC, not just over `/opds`.** Parity map:

| OPDS route                          | XRPC method                                        |
| ----------------------------------- | -------------------------------------------------- |
| `GET /opds` (root nav + counts)     | `listPersonalShelves` — the root call, one request |
| `GET /opds/all`                     | `getPersonalLibrary`                               |
| `GET /opds/shelves/:id`             | `getPersonalLibrary?shelfId=`                      |
| `GET /opds/search/results`          | `getPersonalLibrary?q=&sort=title` (same SQL)      |
| `GET /opds/books/:hash/download`    | `getPersonalBookFile`                              |
| `GET /opds/books/:hash/cover`       | `getPersonalBookCover`                             |
| `GET /opds/search` (OpenSearch doc) | n/a — an XRPC client reads the lexicon instead     |

**Two methods declare non-JSON bodies**, which is what makes upload and download work at all:

- `uploadPersonalBook` — `input.encoding` is an explicit ebook MIME list **plus
  `application/octet-stream`**, and the filename is a required **query param**
  (it replaced an `x-file-name` header that defaulted to `"unknown"`). Two
  things to know before touching this: `@atcute/lex-cli` emits **no MIME
  validator at all** when the encoding is exactly `*/*` (which is what the old
  lexicon said), and `constructMimeValidator` is **exact-match** — `image/*` in
  an encoding list is a literal, not a wildcard, so every type must be
  enumerated. `octet-stream` is in the list deliberately: the iOS app sends
  `type: mime || "application/octet-stream"`, mobile document pickers report it
  for `.epub`, and `curl --data-binary` sends form-urlencoded. The declared
  type is client-asserted and worthless as a control — **`detectFormat`
  checking magic bytes against the filename's extension is the real gate**, and
  `filename` is required because `.epub`/`.cbz`/`.fb2.zip` are all zip
  containers that nothing else can tell apart.
- `getPersonalBookFile` / `getPersonalBookCover` — blob outputs, so the handler
  returns a bare `Response` and owns every header (the `json()` helper is only
  typed for lex outputs, and the router sets no Content-Type for you). Both are
  in `ETAG_EXCLUDED_PREFIXES` and skipped by `compress()` in `src/app.ts`, by
  **exact NSID path** rather than a `/xrpc/` prefix — the prefix would cost the
  other ~35 JSON methods their 304s.

## Scrapers (`src/scrapers/`)

| File               | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `goodreads.ts`     | Search API scraper                             |
| `moreInfo.ts`      | Goodreads page scraper (genres, series, meta)  |
| `getHiveId.ts`     | HiveId generation (hash of title+author)       |
| `languageNames.ts` | Language name normalization                    |
| `index.ts`         | `findBookDetails` entry point                  |
| `waf/`             | AWS WAF challenge solver (see `waf/README.md`) |
| `google.ts`        | Google Books scraper — **not wired up**        |
| `isbndb.ts`        | ISBNdb scraper — **not wired up**              |

`google.ts` and `isbndb.ts` are **tracked but not wired up** — nothing imports
them and `findBookDetails` has no fallback branch that would reach them, so
Goodreads is the only scraper actually running. They are kept deliberately, as
the starting point for a fallback when Goodreads' WAF is rejecting us; treat
them as reference material, not live code, and don't assume a Goodreads failure
degrades to either one. `images.isbndb.com` stays in the `imageProxy` allowlist
because historical `hive_book` rows still point there.

**`waf/` holds two operations that must never share a fate.** `solver.ts` fetches
the page on the main thread — always, with no gate of any kind in front of it —
and only hands a challenge off to `solver-worker.ts` if one actually comes back.
The invariant is:

> No book is ever failed without a request to Goodreads having been sent and answered.

There is **no circuit breaker here, and adding one back is a regression.** There
used to be: it was fed by solve outcomes and gated the page fetch, so when AWS
WAF stopped honouring our tokens it sat open and refused the path that still
worked — 8,606 refusals across 6,840 books in one 6h window, breaker open 254 of
360 minutes, while the requests it did allow through succeeded 95.6% of the time.
The three things it protected are each handled better elsewhere: solve cost by
single-flight + one attempt per token lifetime (`SOLVE_MIN_INTERVAL_MS`, derived
from the measured 300s token validity, not tuned); request rate by
`ENRICH_CONCURRENCY`/`DRAIN_INTERVAL_MS`, which already cap us at 36 fetches/min;
and memory by there being at most **one** solver Worker per process, terminated
on every path. `waf/README.md` has the full account, including why solving
currently fails from the production host but not from a residential IP.

## Auth (`src/auth/`)

| File               | Purpose                                                       |
| ------------------ | ------------------------------------------------------------- |
| `router.tsx`       | Login/logout/OAuth callback routes                            |
| `client.ts`        | OAuth client creation                                         |
| `storage.ts`       | Session/state stores (unstorage-backed)                       |
| `handle.ts`        | Handle validation                                             |
| `refresh-lock.ts`  | Cross-process token-refresh lock (SQLite `auth_refresh_lock`) |
| `restore-guard.ts` | Per-PDS timeout (5s) + circuit breaker around `restore()`     |

**Key constraint**: `guardedRestore` wraps every OAuth restore in a 5s timeout + circuit breaker keyed by the authorization-server host. `getSessionAgent` only destroys sessions on terminal credential errors, never on timeouts.

### XRPC auth (`src/xrpc/auth.ts`)

`/xrpc/*` accepts **two** credentials, resolved by `resolveXrpcAuth`:

- the `sid` iron-session cookie (web + iOS, unchanged);
- an **atproto inter-service auth JWT** as `Authorization: Bearer <token>`
  ([spec](https://atproto.com/specs/xrpc#inter-service-authentication-jwt)) —
  the client calls `com.atproto.server.getServiceAuth` on its own PDS with
  `aud` and `lxm`, and we verify with `ServiceJwtVerifier` from
  `@atcute/xrpc-server/auth`. This is what makes the personal library usable
  from a script or an e-reader rather than only from a browser session.

Bearer wins when both are present. A method declares what it needs with
`auth: "identity" | "pdsWrite"` on its registration, and the wrapper in
`createXrpcRouter` **derives the `lxm` from the schema's own NSID**, so a
method's route and its token binding cannot drift apart. Handlers then read
`getAuth()` / `requireAgent()` instead of repeating a `getSessionAgent()`
preamble.

- `identity` — we only need the DID. Every personal-library and sync method:
  none of them touch the agent for anything but `.did` (progress bridging
  writes `user_book` and queues a deferred PDS write via `sync_pending:`).
- `pdsWrite` — writes a record to the user's repo, so it needs a live OAuth
  session. **Service auth can never satisfy this** — it proves key control, not
  that we hold a grant. Only the six book-list procedures.

Three things that are load-bearing and easy to get wrong:

- **`acceptAudiences` is exact string `Array.includes`.** A bare DID does _not_
  match a `DID#fragment` audience, so both spellings are listed. The fragment
  is there in advance of a PLC operation adding a `#bookhive_appview` service
  entry; the live DID document has only `#atproto_pds`, so **PDS proxying via
  `atproto-proxy` cannot work today** and clients must mint a token and POST to
  us directly.
- **`SERVICE_AUTH_MAX_AGE_SECONDS` is 3600, not atcute's 300** (a constant in
  `src/context.ts`). A PDS mints up to an hour when `lxm` is set and most SDKs
  don't expose `exp`, so the stricter default rejects ordinary tokens as
  `JwtTooOld`. The token's own `exp` is still enforced separately.
- **There is no prior-relationship gate.** A valid service token from _any_ DID
  on the network is accepted — we deliberately do not require that the DID has
  signed in to BookHive before. BookHive signup is open, so such a gate bought
  little, and the **per-user storage quota** (`PERSONAL_LIBRARY_QUOTA_BYTES`) is
  the real backstop on what a caller can consume. `pdsWrite` methods are still
  refused (service auth proves key control, not an OAuth grant), so the exposure
  is bounded to the identity/personal-library surface.

`lexicons/auth.json` carries the `rpc` permission that lets a client mint these
tokens at all; **`GRANULAR_SCOPES` in `src/auth/client.ts` must move with it**
(it is the `USE_PERMISSION_SETS = false` fallback, and granting in only one
place silently drops it for whichever path is live). Note that adding `rpc`
permissions means **existing users must re-consent** before their PDS will
issue tokens for these methods.

There is **no replay protection**: a token is already scoped to one `lxm` and
one audience, and within its short `SERVICE_AUTH_MAX_AGE_SECONDS` window a reused
one authenticates the same DID it always did. Service auth is also **always on**
— there is no kill-switch env var; the cookie path is unaffected by it either
way.

## Middleware (`src/middleware/`)

Applied globally in `src/app.ts`. Key middleware:

- `anon-page-cache.ts` — anonymous page cache (prod only)
- `otel-middleware.ts` — OpenTelemetry route spans (renamed after `next()` to `METHOD /matched/:route`)
- `sync-auth.ts` — KOSync auth (validates `x-auth-user`/`x-auth-key`). Exports `deriveSyncPassword`, `currentSyncPassword`, `rotateSyncToken`
- `opds-auth.ts` — OPDS HTTP Basic auth (same derived password as KOSync)

Tracing: app → OpenObserve directly (`server/plugins/otel-sdk.ts`). Two spans per request (nitro root + hono route).

## Styling

- **Tailwind CSS v4** with `@tailwindcss/forms` and `tailwindcss-animated`
- Config: `tailwind.config.js` — `darkMode: "class"`; theming lives in `:root`/`.dark` CSS vars in `src/index.css`
- Entry: `src/index.css`

**basecoat's button variants are standalone classes, not modifiers.** `.btn` _is_ the primary
variant (`bg-primary text-primary-foreground`); `.btn-ghost` only declares a `:hover` state and
`.btn-outline` overrides the background but not the text colour. The app writes `btn btn-ghost`
in ~40 places, which rendered every one of them as a filled primary button, and `btn btn-outline`
rendered as invisible text. `src/index.css` patches both via the higher-specificity
`.btn.btn-ghost` / `.btn.btn-outline` selectors — keep using the compound form; don't "fix" call
sites individually.

**App-defined classes in `src/index.css`** (basecoat does not provide these; several were already
used in markup before they existed, so that markup silently rendered unstyled):

| Class                                            | What                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `.card-title`                                    | Section heading inside (or outside) a `.card`. Deliberately unscoped                                                         |
| `.empty` / `.empty-title` / `.empty-description` | The one empty-state treatment — prefer it over another hand-rolled `py-12 text-center` block                                 |
| `.focus-ring`                                    | The one focus recipe (`focus-visible` outline on `--ring`). Use instead of `focus:outline-none` plus a hardcoded ring colour |
| `.book-cover-frame`                              | Tinted placeholder on a cover box so lazy-loaded grids don't flash empty                                                     |
| `.book-cover` + `.is-loaded`                     | Cover fade-in. `.is-loaded` is added by the capture-phase `load` listener in `navbar.tsx` — see below                        |
| `.sidebar`, `.tab-label`                         | Pre-existing component classes                                                                                               |

Form controls get a low-alpha white overlay in dark mode rather than `var(--input)` — `--input` is
a saturated amber here, which made every input and outline button look like a filled control.

Tap targets are `min-h-10` / `min-w-10` (not the `min-h-[40px]` bracket form).

**The cover fade is decode-triggered, not insertion-triggered.** `.book-cover` only animates once
it also has `.is-loaded`, which a document-level **capture-phase** `load` listener in
`src/pages/navbar.tsx` adds (`load` doesn't bubble, so capture is what makes one listener cover
every cover on the page, including lazy ones and the covers client islands render after
hydration). Animating on insertion meant the 200ms elapsed before a lazy cover had downloaded, so
the fade only ever played for already-cached covers. Do **not** add an `opacity: 0` default to
`.book-cover` to smooth this — with JS off nothing adds `.is-loaded` and every cover would be
permanently invisible.

**The solid `bg-primary` fill means "call to action", not "you are here".** The sidebar's
`a[aria-current="page"]` rules (nav list and footer, `src/index.css`) use a `bg-primary/15
text-primary` tinted pill for the current page. They used to use `bg-primary
text-primary-foreground` — byte-identical to `.btn-primary` — so in the mobile drawer the active
nav item and the "Buzz in" sign-in button rendered as two indistinguishable filled amber pills.
Keep selected/current states tinted and leave the solid fill to real actions.

## Build & Dev

| Command              | What                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `bun run dev`        | Dev server (`bunx --bun vp dev`)                                                                    |
| `bun run build`      | Production build (`lexgen` + `vp build`) → `.output/server/`                                        |
| `bun run start`      | Run built server (`bun run .output/server/index.mjs`)                                               |
| `bun test`           | Run tests (`bun test src server`)                                                                   |
| `bun run typecheck`  | `vp lint src --type-aware --type-check` + `vp fmt --write`                                          |
| `bun run lint`       | Same as typecheck (oxlint/oxfmt via vp, **not** tsc)                                                |
| `bun run format`     | `vp fmt`                                                                                            |
| `bun run lexgen`     | Regenerate AT Protocol XRPC types from lexicons                                                     |
| `bun run build:boko` | Rebuild the vendored boko WASM in `vendor/boko/` (needs Rust + wasm-pack; only to bump the version) |

**Build pipeline**: Vite+ wrapping Vite 8 + Rolldown + Nitro (preset `bun`). Production builds use custom entry `server/entry.bun.mjs` (adds `reusePort: true`). Docker CMD is `server/cluster.ts` under `tini` init. The `standaloneBundles()` Vite plugin builds 6 worker entry points into `.output/server/workers/` — the five under `src/workers/` (including the single-shot `parse-worker.ts`) plus `src/scrapers/waf/solver-worker.ts`. TypeScript type checking via **tsgo** (TS 6.x); linting via **oxlint**, formatting via **oxfmt**, both through the `vp` CLI. **Do not use `@/…` in `src/` or `server/`.** `vite.config.ts` maps `@` → `./src`, but the root `tsconfig.json` has no matching `paths`, so tsgo cannot resolve it and the import fails typecheck while bundling fine. Nothing in `src/`/`server/` uses it today; the alias that _is_ live is `app/`'s own `@/*` → `app/*`, declared in `app/tsconfig.json`. Runtime requires `bun >= 1.3.14`. Pre-commit hook runs `vp staged` → `vp check --fix`.

Notable deps: hono, kysely, zod 4, iron-session, unstorage + ocache, `@atcute/*`, `@takumi-rs/image-response` + React 19 (OG only), pino, `@hono/prometheus`, `@opentelemetry/*`, basecoat-css, envalid.

**`bunfig.toml` preloads `src/test/env-setup.ts`, and that is load-bearing.**
envalid freezes `env` at import, so `DB_PATH`/`LIBRARY_DIR` can only be set
before the import graph loads. Without it `DB_PATH` falls back to `":memory:"`,
`getLibraryDir()` resolves to **`./library` inside the checkout**, and any test
exercising an upload writes ebooks into the working tree.

Related trap, since it cost real debugging time: **`mock.module("../env", …)` is
process-wide and permanent.** Returning a bare object from it replaces `env` for
every module loaded afterwards in the same run, so every field the mock doesn't
name reads back as `undefined`. `src/auth/session.test.ts` and
`token-refresh.test.ts` spread the real env for exactly this reason — the
failure shows up in an unrelated file that passes in isolation.

## iOS App (`app/`)

Separate Expo/React Native workspace — see `app/ARCHITECTURE.md`. Consumes personal-library and KOSync surfaces (XRPC `*PersonalBook`/`*PersonalShelf` methods, REST `/library/*`, `/settings/sync/*`, `POST /library/upload`).

**The app renders `payload.error` verbatim for any non-2xx upload response**, which is why the quota rejection is a 413 carrying human prose rather than a bare code — already-installed builds show the right message with nothing shipped. It reads `storage` off `getPersonalLibrary` for its own meter and pre-flight check, so **anything that changes the quota's wire shape needs an app release**, unlike the message text. `app/utils/personalLibrary.ts` `formatBytes` is a deliberate byte-for-byte copy of the server's; if they diverge, the 413 alert and the meter under it disagree about how full the library is.

## Third-party clients (service auth)

What to tell someone who wants to script against the personal library:

```http
# 1. Mint a token on YOUR OWN PDS, bound to one method and one audience.
#    exp should be short; one token per call is what Bluesky's own PDS does.
GET  https://<your-pds>/xrpc/com.atproto.server.getServiceAuth
       ?aud=did:plc:enu2j5xjlqsjaylv3du4myh4
       &lxm=buzz.bookhive.uploadPersonalBook
       &exp=<now + 60>
  -> { "token": "..." }

# 2. Call BookHive directly with it. `filename` is a required query param and
#    the body is the raw file — no multipart wrapper.
POST https://bookhive.buzz/xrpc/buzz.bookhive.uploadPersonalBook?filename=Dune.epub
  Authorization: Bearer <token>
  Content-Type: application/epub+zip
  <raw bytes>
```

Notes worth passing on: `lxm` is **required** (atcute's parser rejects a token
without it); the audience must match one of `acceptAudiences` **exactly**;
`atproto-proxy` will not work until the DID document gains an AppView service
entry. There is no requirement that the account have used BookHive before — any
valid token is accepted, bounded by the per-user storage quota. The OAuth client
must have been granted the `rpc:buzz.bookhive.*` scopes, which means **existing
users need to re-consent** before their PDS will issue these tokens.

## Workers, Logging & Observability

| Path                                 | Purpose                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `src/workers/ingester-worker.ts`     | Jetstream ingest (off-thread)                           |
| `src/workers/og-render/`             | OG image render (React + takumi)                        |
| `src/workers/open-observe-worker.ts` | pino → OpenObserve log shipping                         |
| `src/workers/import/`                | CSV import processing                                   |
| `src/logger/index.ts`                | pino logger; redacts cookies                            |
| `src/metrics.ts`                     | Prometheus metrics                                      |
| `src/pds/client.ts`                  | Self-hosted PDS support                                 |
| `server/cluster.ts`                  | Multi-process supervisor (Docker CMD)                   |
| `server/worker-exit.ts`              | Exit classification + procfs memory read                |
| `server/entry.bun.mjs`               | Custom Nitro entry (SO_REUSEPORT)                       |
| `server/plugins/`                    | `otel-sdk.ts`, `request-tracing.ts`, `cache-headers.ts` |

Per-process metrics carry a `worker` label from `WORKER_INDEX`. Memory debugging: use `Anonymous` (not `Rss`) — RSS includes reclaimable SQLite mmap. `/debug/memory` separates them.

## Context & Session (`src/context.ts`)

`AppContext` — singleton deps: `db`, `kv`, `ingester`, `oauthClient`, `resolver`/`baseIdResolver`, `getSessionDid()` (fast cookie-only DID), `getSessionAgent()` (OAuth session), `getProfile()`, `serviceAccountAgent`, `addWideEventContext`.

Hono context vars (`c.get`): `ctx`, `assetUrls`, `requestId`, `wideEventBag`, `appLogger`, `requestError`.

`createAppDeps()` builds deps and (primary only) spawns the ingester + enrichment drain. Sessions use `iron-session` (180-day cookie) with an in-memory `SessionClient` cache. `getProfile` is read-through cached (24h revalidate / 30d TTL).
