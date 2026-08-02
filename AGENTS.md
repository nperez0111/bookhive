# BookHive — Agent Reference Index

Goodreads alternative built on Bluesky's AT Protocol. Server-rendered Hono JSX with minimal client-side hydration via `hono/jsx/dom`. Bun runtime, SQLite via Kysely, Tailwind CSS v4. Built with Vite + Nitro (preset `bun`), output to `.output/server/`.

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
                │       └── src/index.css      ├── Goodreads / Google / ISBNdb scrapers
                │                              └── Worker threads (see below)
                └── static files (public/)

Worker threads (src/workers/, bundled to .output/server/workers/):
  ingester-worker     — Jetstream firehose ingest
  og-render-worker    — OG image generation (React + takumi)
  open-observe-worker — pino log shipping to OpenObserve
  import-worker       — CSV import processing
```

**Key pattern**: Server components (`src/pages/`) render full HTML. Only 6 islands are hydrated client-side (`src/client/`). Most interactivity is CSS-only (peer/checked selectors for tabs, dropdowns, modals) or inline `<Script>` vanilla JS.

**Asset URLs**: In production, resolved from the Vite build manifest via `src/utils/manifest.ts` (`loadViteManifest`/`getAssetUrlsFromManifest`), exposed on the Hono context as `assetUrls`. The `/_bundle` HTML import route still exists for Bun dev.

**Ingester runs as a worker thread**, not in-process. `createAppDeps` spawns `new Worker(ingester-worker)`; `ingester.destroy()` terminates it. Worker posts `wideEvent` messages back to the pino logger. **Primary worker only** (see below).

**Production is multi-process**: the Docker CMD is `server/cluster.ts`, a supervisor that spawns `WEB_CONCURRENCY` (default 4) copies of `.output/server/index.mjs`, all sharing port 8080 via SO_REUSEPORT (`reusePort: true` in the custom Nitro entry `server/entry.bun.mjs`). Worker 0 is the **primary** (`isPrimaryWorker` in `src/context.ts`, from `WORKER_INDEX`): only it runs DB migrations + VACUUM and the Jetstream ingester. The supervisor starts worker 0 alone, waits for `/healthcheck`, then spawns the rest — that ordering is the migration barrier. `WORKER_INDEX` unset (dev/tests/bare run) behaves as primary.

**Goodreads enrichment is queued, never inline**: routes call
`enqueueEnrichment`/`enqueueEnrichmentBatch` (`src/utils/enrichQueue.ts`) — one
`INSERT OR IGNORE` into `enrich_queue`, keyed by `hiveId` so re-queueing is free.
The **primary worker only** drains it every 5s at `ENRICH_CONCURRENCY` (3), with
exponential backoff (1m/5m/30m, 4 attempts) and stale-claim reclaim. Each item
emits exactly one terminal `msg: "enrichment"` pino event — `addWideEventContext`
is useless for detached work because the request's wide event has already
flushed. `enrichBookWithDetailedData` additionally holds its own semaphore (4)
and a 45s deadline so no call site can reintroduce an unbounded fan-out. This
replaced a 20-way-per-search fan-out of solver Workers that OOM-killed workers
every 5–7 minutes on 2026-08-01. Because the drainer is primary-only it is a
silent SPOF, so `publishEnrichQueueStats` emits `msg:
"enrich_drainer_heartbeat"` every 60s and sets `bookhive_enrich_queue_depth` —
without it, a crash-looping worker 0 is indistinguishable from an idle queue.

**Author lookups go through `hive_book_author`, not `LIKE`** (mig 020).
`authors` is tab-separated, so "books by X" used to be four LIKE patterns
(sole/first/middle/last), two of them leading-wildcard and therefore
unindexable: `/authors/:author` planned `SCAN hive_book` + a temp B-tree over
356k rows at ~511ms, and the author directory had to `GROUP BY` a
`CASE/instr/substr/trim` expression to recover the first author. Verified
against production, the join returns identical counts at 1ms vs 65ms.
Deliberately **not** FTS5 — this is exact identity, not text search; "Stephen
King" must not also match "Stephen Kingsley". Triggers rather than a
`syncHiveBookGenres`-style helper because `hive_book.authors` is written from
the ingester, importer, enrichment and catalog service, and a helper only has
to be forgotten once to desynchronize silently.

**Library re-sync fans out at most `REFETCH_SEARCH_CONCURRENCY` (3) searches**
(`src/routes/lib.ts`). `refetchBooks` used to push one `searchBooks` per record
straight into a `Promise.all`, 100 per page, recursing over the whole library —
each one an outbound Goodreads fetch _and_ a `LIKE '%…%'` scan of all 356k
`hive_book` rows sorting into a temp B-tree. `src/workers/import/logic.ts`
already chunked the identical work at 3.

**Anonymous page cache**: `src/middleware/anon-page-cache.ts` serves GET requests without a `sid` cookie on `/books/*`, `/explore*`, `/authors/*` from the shared KV (`page:` mount, gzipped HTML, 1h TTL, query-param allowlist `page`/`sort`/`lang`/`review-id`; other params bypass). Prod-only. The primary worker sweeps expired `page_cache` rows every 15 min. The nitro plugin `server/plugins/html-cache-headers.ts` is the authoritative Cache-Control for HTML on these routes (anon → `public, max-age=3600`; `sid` cookie → `private`) — it runs on the final response because Hono-set headers can be replaced by nitro's route-rule header middleware (the static-asset globs in `vite.config.ts` routeRules leak onto app routes).

## Entry Points

| File                   | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `src/index.ts`         | Bun.serve — HTML bundle route + Hono fetch handler                  |
| `src/server.ts`        | Wires deps via `createAppDeps()` + `createApp()`; graceful shutdown |
| `src/app.ts`           | Hono app factory — all middleware + route mounting                  |
| `src/entry.html`       | Bun HTML bundle entry (imports CSS + client JS)                     |
| `src/client/index.tsx` | Client bundle entry — mounts 6 hydrated components                  |

## Routes

`src/app.ts` (`createApp`) mounts top-level infra/admin routes, then `/` →
`src/routes/main.tsx` (`mainRouter`). `mainRouter` registers a few standalone
pages, the image proxy, then mounts the feature route modules and the XRPC
router. Middleware order in `createApp`: `timing` → `prettyJSON` (dev) →
context → wide-event logging → error capture → asset URLs (Vite manifest) →
`secureHeaders` → `compress` → `jsxRenderer` → OpenTelemetry → `etag` →
anon page cache (prod, `/books/*`, `/explore*`, `/authors/*`).

**`etag()` must never see a large or streamed body.** It does `res.clone()` and
drains one tee branch through the digest while nothing reads the other, so the
whole body is buffered in native memory before a single byte reaches the client
— measured at 134 MB of `arrayBuffers` for a 120 MB download — and streaming is
defeated outright. `/library/books/*` and `/opds/books/*` are excluded by prefix
and set their own strong ETag from the stored `contentHash`, so e-readers keep
their 304s; `/import` is excluded by being mounted _above_ the middleware, since
its SSE stream never ends and the digest would never complete.

### Mounted in `src/app.ts` (infra/admin, before `mainRouter`)

- `/healthcheck` → JSON status + git sha + startedAt
- `/metrics` → Prometheus (`@hono/prometheus` defaults + custom registry)
- `/sitemap.xml` → static sitemap (`/`, `/app`, `/privacy-policy`)
- `/admin/*` → `src/routes/admin.ts` (gated by `EXPORT_SHARED_SECRET`)
- `/debug/*` → `src/routes/debug.ts` (gated by `EXPORT_SHARED_SECRET`). `GET /debug/memory` returns `process.memoryUsage()`, parsed `/proc/self/smaps_rollup`, the resident mappings over 20 MB, and any open PDS breakers — the breakdown needed to tell an anonymous leak from the reclaimable SQLite mmap
- `/import` (POST `/goodreads`, `/storygraph`) → `src/routes/import.ts` — CSV import handler
- `app.notFound` → JSON 404

### Standalone pages in `src/routes/main.tsx`

- `/privacy-policy` → `src/pages/privacy-policy.tsx`
- `/legal` → `src/pages/terms.tsx` — terms of service
- `/pds` → `src/pages/pds.tsx` — PDS info (redirects to `/` if PDS disabled)
- `/` → `src/pages/marketing.tsx` — marketing landing; redirects to `/app` for the iOS host/`?app`, to `/home` when logged in; trending books + recent activity, cached 1h via `readThroughCache`
- `/images/*` → signing reverse-proxy to **imgproxy** (remote sources only; allowed hosts `i.gr-assets.com`, `cdn.bsky.app`, `images.isbndb.com` via `src/utils/imageProxy.ts` — keep this set in sync with `IMGPROXY_ALLOWED_SOURCES` in `compose.yaml`; the upstream fetch has a 10s timeout; URL modifiers like `w_440` / `s_300x500,fit_cover` translated to imgproxy options and signed server-side with `IMGPROXY_KEY`/`IMGPROXY_SALT`; SVG fallback on forbidden/failed source; meant to be edge-cached by Cloudflare). If `IMGPROXY_URL` is unset, redirects to the source URL. **Replaced the Bun.Image proxy.** Three route shapes share one proxy helper (`proxyImageResponse` in `src/utils/imageProxy.ts`):
  - **ID-keyed canonical (preferred for web)** — `GET /images/books/:hiveId?w=440` resolves the current cover from `hive_book`; `GET /images/avatars/:did?s=120` resolves the current avatar via `getProfile`. These URLs are permanently stable and never leak the upstream provider; size is a query param (`w`/`h`/`s`/`q`/`fit`). Built by helpers `coverImageUrl(hiveId, {width})` → `/images/books/{hiveId}?w=N` and `avatarImageUrl(did, {size})` → `/images/avatars/{did}?s=N` (both `undefined` for falsy id). Registered **before** the catch-all (Hono order).
  - **Source-embedded (stateless)** — the catch-all `/images/{modifiers}/{source}` proxies a raw upstream URL directly. Used by OG render (`src/routes/og.tsx`, inline `${origin}/images/w_N/{url}`) and the iOS app (`s_300x500,fit_cover…`). Built by helpers `sourceCoverImageUrl(source, {width})` / `sourceAvatarImageUrl(source, {size})` for callers that only have a raw source URL (author thumbnails, `UserBlock`). `parseImagePath` repairs the protocol slash browsers collapse (`https:/…` → `https://…`).
- `/login`, `/logout`, `/oauth/callback` → `src/auth/router.tsx` — OAuth flows (`loginRouter`)

### `src/routes/pages.tsx` (mounted at `/`)

- `/home` → `src/pages/home.tsx` — authenticated home (redirects to `/` if no profile)
- `/feed` → `src/pages/feed.tsx` — activity feed, friends/all/tracking tabs (paginated 25/page)
- `/app` → `src/pages/app.tsx` — iOS app landing
- `/import` → `src/pages/import.tsx` — Goodreads/StoryGraph CSV import, SSE progress
- `/search` → `src/pages/searchResults.tsx` — search (zValidator query `q`/`page`/`lang`)
- `/explore` → `src/pages/explore.tsx` — explore hub (cache-control 1h)
- `/explore/genres` → `src/pages/genres.tsx` — genre directory
- `/explore/genres/:genre` → `src/pages/genreBooks.tsx` — books by genre, paginated, sortable (popularity/relevance/reviews)
- `/explore/authors` → `src/pages/authorDirectory.tsx` — author directory
- `/authors/:author` → `src/pages/authorBooks.tsx` — books by author, paginated
- `/genres`, `/genres/:genre` → 301 redirects to `/explore/genres`
- `/.well-known/atproto-did` → returns DID constant

### `src/routes/profile.tsx` (mounted at `/`)

- `/refresh-books` → re-sync books from PDS (auth)
- `/profile` → redirects to `/profile/:handle`
- `/profile/:handle` → `src/pages/profile.tsx` — profile, shelves, follow counts (cached 5m), lists, genre stats
- `/profile/:handle/image` → redirect to avatar
- `/profile/:handle/stats` → redirect to `/stats/:currentYear`
- `/profile/:handle/stats/:year` → `src/pages/readingStats.tsx` — reading stats by year (all-time fallback)

### `src/routes/books.tsx` (mounted at `/books`)

- GET `/:hiveId` → `src/pages/bookInfo.tsx` — book detail. `hiveId` must match `^bk_[A-Za-z0-9]+$` (else 400 + a `bad_hive_id` wide-event field). Stale books (>30d) are **queued** for enrichment, never scraped inline; `?force-refresh=true` still enriches inline but with a 15s ceiling and falls back to existing data
- DELETE `/:hiveId` → delete book record from PDS + DB
- POST `/` → add/update book (zValidator form incl. `bookProgress`); per-DID `book_lock` KV, 429 if locked
- GET `/:hiveId/comments` → `src/pages/comments.tsx` — comments/reviews section

### `src/routes/comments.tsx` (mounted at `/comments`)

- POST `/` → create/update buzz (form)
- DELETE `/:commentId` → delete buzz

### `src/routes/shelves.tsx` (mounted at `/shelves`)

User book lists ("shelves"). Lists use the **shared popfeed lexicons**
(`social.popfeed.feed.list` / `.listItem`), AT URI form
`at://${did}/social.popfeed.feed.list/${rkey}`. Delegates to `src/utils/lists.ts`.

- GET/POST `/new` → create list
- GET `/:handle` → user's shelves; GET `/:handle/:rkey` → single shelf
- GET/POST `/:handle/:rkey/edit`, POST `/:handle/:rkey/delete`
- POST `/add` (from book page), POST `/:handle/:rkey/add`, POST `/:handle/:rkey/remove`

### `src/routes/settings.tsx` (mounted at `/settings`)

- GET `/` → `src/pages/settings.tsx` (auth)
- POST `/delete-account` → delete account data, revoke OAuth, destroy session
- GET `/sync/password` → current KOSync password (derived); POST `/sync/rotate` → bump the rotation counter and return the new one
- GET `/sync/documents` → the user's synced e-reader documents (+ linked book title); POST `/sync/link` (`{document, hiveId}`) → link a document to a book and bridge its progress via `src/utils/syncBridge.ts`

### `src/routes/library.tsx` (mounted at `/library`)

Personal library: ebook uploads (= the OPDS catalog, served by `src/routes/opds.ts`), e-reader credentials, sync documents. All routes require session auth.

- GET `/` → `src/pages/library.tsx` (auth). With no books _and_ no synced documents it renders an explainer with the credentials block and upload dropzone inline; otherwise a header with two `<dialog>` triggers plus the `LibraryManager` island.
- POST `/upload` → multipart file upload handler (validates format via `detectFormat`, computes the KOReader partial MD5 as `contentHash`, parses metadata via `parseBook`, writes to disk, inserts `personal_book`, auto-links from a `sync_document` with the same hash). Content-negotiated: `Accept: application/json` (the mobile app) gets `{ book }` in the `personalBookView` shape, or 409 on a duplicate; the browser form gets a 302 back to `/library`. Size is checked against `file.size` **before** `arrayBuffer()` — the check used to run after, so rejecting an oversized upload still cost a full copy of it in native memory. The XRPC `uploadPersonalBook` procedure enforces the same `MAX_PERSONAL_BOOK_BYTES` (it previously had no limit at all).
- GET `/covers/:hash` → extracted cover image for a personal book
- GET `/books/:hash/download` → session-authenticated file download; shares `streamPersonalBook` (`src/utils/personalLibrary.ts`) with the Basic-auth OPDS route.
- GET `/shelves` → JSON list of user's personal shelves with book counts (`{ shelves: [{ id, name, description, bookCount, createdAt, updatedAt }] }`)
- GET `/sync/password` → current KOSync password (same as settings, duplicated here for library page)
- POST `/sync/rotate` → rotate sync token (same as settings)
- GET `/sync/documents` → synced e-reader documents; each row carries `hasFile` (an upload shares its hash) and `dismissed`.
- POST `/sync/link` (`{document, hiveId}`) → link synced document to hive book
- POST `/sync/dismiss` (`{document, dismissed}`) → write/clear the `NO_HIVE_MATCH` sentinel; 404s rather than clobbering a real link.
- POST `/sync/rename` (`{document, title}`) → name a document that arrived without metadata
- POST `/sync/delete` (`{document}`) → forget a synced document and its e-reader progress. Scoped to `sync_document`; leaves `user_book.bookProgress` alone.

### `src/routes/api.tsx` (mounted at `/api`) — JSON/form mutations

- POST `/update-book`, `/update-comment`
- POST `/follow`, `/follow-form`, `/unfollow`, `/unfollow-form` (writes `app.bsky.graph.follow` + `user_follows.isActive`)

### `src/routes/rss.ts` (mounted at `/rss`)

- GET `/user/:handle`, `/book/:hiveId`, `/friends/:handle` → RSS 2.0 feeds

### `src/routes/opds.ts` (mounted at `/opds`) — e-reader catalog

Serves the user's personal library (`personal_book` / `personal_shelf`) to
e-readers. Every route is behind `src/middleware/opds-auth.ts`: HTTP Basic with
the Bluesky handle as username and the **same derived password as KOSync**
(`currentSyncPassword`), compared in full rather than as an md5.

**Dual-format.** The four feed routes emit either OPDS 1.2 Atom XML or OPDS 2.0
JSON depending on the request's `Accept` header (`wantsOpds2()` — true when it
contains `application/opds+json`). KOReader ≥ [#15696](https://github.com/koreader/koreader/pull/15696)
(header fixed in [#15751](https://github.com/koreader/koreader/pull/15751)) sends
`application/opds+json, application/atom+xml;profile=opds-catalog, */*` and picks
its parser from the **first byte of the body** (`{` → 2.0, `<` → 1.x), not from
`Content-Type`. Older clients send no such header and keep getting XML.

- GET `/` → root navigation feed (All Books + one entry per shelf). The 2.0 form
  is a `navigation` array carrying `properties.numberOfItems` per entry; the 1.x
  form has no counts, so the count queries only run on the JSON path.
- GET `/all`, `/shelves/:id`, `/search/results` → acquisition feeds, paginated at
  `OPDS_PAGE_SIZE` (24, `src/utils/personalLibrary.ts`). 2.0 emits
  `metadata.{numberOfItems,itemsPerPage,currentPage}` plus `publications[]`.
- GET `/search` → OpenSearch description (1.x only; advertises `q`). The 2.0
  feeds instead carry a templated `rel: "search"` link — see `opds2SearchLink`
  for why it is spelled `?query={query}` and not `{?query}`. `/search/results`
  therefore accepts **both** `q` and `query`.
- GET `/books/:hash/download` → shares `streamPersonalBook` with `/library`.
- GET `/books/:hash/cover` → local cover file, else redirect to `/images/books/:hiveId`.

OPDS 2.0 publications use the exact rel strings KOReader matches:
`http://opds-spec.org/acquisition`, `.../image`, `.../image/thumbnail`.
Tests: `src/routes/opds.test.ts`.

### `src/routes/og.tsx` (mounted at `/og`) — OG images (offloaded to og-render worker)

- `/marketing`, `/book/:hiveId`, `/profile/:handle`, `/profile/:handle/stats/:year`, `/author/:author`, `/genre/:genre`, `/app` → `image/webp`, cached per-TTL

A failed render **never 500s**: `makeOgResponse` serves `public/og-fallback.png`
at 200 with `max-age=300` and records the cause on the wide event. Crawlers cache
a failed preview, so a 500 here breaks a book's link previews indefinitely.
`src/workers/og-render/client.ts` holds one worker per process; a timeout rejects
only that render (recycling the worker after 3 consecutive timeouts) and the
queue is capped at 32 pending — shed renders increment
`bookhive_og_render_shed_total` and log `og_render_shed`, because that rejection
used to be silent. `OG_RENDER_OPTIONS.onError` suppresses takumi's
`defaultErrorHandler`, which wrote unstructured `Failed to render image.` +
raw DOMException dumps to stdout.

**Rendered cards are cached in the shared KV**, not in process memory —
`src/utils/ogCache.ts` (`og:` mount → `og_cache` table), with a per-process
in-flight map that collapses a concurrent burst on one cold card into a single
render. This was ocache's `defineCachedFunction`, whose default store is a plain
`Map` with **no size cap or eviction**, holding webp bytes as `Uint8Array` —
native memory, invisible to `heapUsed`, duplicated per worker, for up to 7 days.
Production traffic is a crawler sweeping the catalog (674 distinct cards in 3h
at a 4.4% hit rate), so it only ever grew. The primary worker sweeps `og_cache`
and publishes `bookhive_og_cache_entries`/`_bytes` on the same 15-min timer as
`page_cache`. The plumbing lives in `src/utils/ogCache.ts` rather than here
specifically so `src/context.ts` can run the sweep without an import cycle
through the render worker's module-scope pino instance.

### `src/routes/sync/kosync.ts` (mounted at `/kosync`) — KOReader sync (KOSync protocol)

Implements the KOSync protocol for syncing reading progress from KOReader e-readers.
Auth uses `x-auth-user` (Bluesky handle) + `x-auth-key`. The password is a
deterministic `HMAC-SHA256(COOKIE_SECRET, "${did}:${version}")` (32-hex chars),
where `version` is a per-user rotation counter in KV (`sync_token:{did}`, default 0) that the user can bump from Settings to invalidate a leaked password. KOReader
transmits `md5(password)` as `x-auth-key`, so `src/middleware/sync-auth.ts`
compares against the md5 of the derived value. `deriveSyncPassword` /
`currentSyncPassword` / `rotateSyncToken` are exported for the Settings page.
Progress is stored in the `sync_document` table and written optimistically to
`user_book.bookProgress` (not dependent on the firehose). Deferred PDS writes are
queued in KV (`sync_pending:{did}`) and flushed via the canonical
`updateBookRecord` whenever a session agent is available (see
`flushPendingSyncWrites` in `src/context.ts`). Documents auto-bridge to a book
only on an **exact** `getHiveId` match (`src/utils/syncMatching.ts`); a miss
leaves `hiveId` null and still syncs progress at the document level.

**`NO_HIVE_MATCH` sentinel** (`src/utils/syncMatching.ts`, value `bk_none`):
written to `sync_document.hiveId` when the user says a document has no BookHive
counterpart. Read paths must surface it as `{ hiveId: null, dismissed: true }` so
nothing links to `/books/bk_none`.

- `POST /users/create` → returns 403 directing users to BookHive Settings
- `GET /users/auth` → validates sync credentials
- `PUT /syncs/progress` → push reading progress (upserts `sync_document`, exact-matches to BookHive books via `src/utils/syncMatching.ts`)
- `GET /syncs/progress/:document` → pull progress for a document hash
- `GET /syncs/documents` → list all synced documents

### Other

- `/xrpc/*` → `src/xrpc/router.ts` — AT Protocol XRPC endpoints (see below)

Shared route helpers: `src/routes/lib.ts` — `cacheControl`, `searchBooks`,
`ensureBookIdentifiersCurrent`, `refetchBooks`, `refetchBuzzes`, `refetchLists`,
`syncFollowsIfNeeded`. `src/routes/index.ts` re-exports `searchBooks`,
`mainRouter` (and a `@deprecated` `createRouter`).

## Server-Side Pages (`src/pages/`)

Each file exports a Hono JSX component rendered server-side.

| File                  | Renders                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `layout.tsx`          | HTML shell — meta tags, asset injection, `<head>`/`<body>` wrapper |
| `navbar.tsx`          | Top nav bar with user menu, search mount point                     |
| `simple-navbar.tsx`   | Simplified nav bar variant                                         |
| `sidebar.tsx`         | Sidebar layout component                                           |
| `home.tsx`            | Landing/home page — hero, features, book list, buzzes              |
| `marketing.tsx`       | Marketing landing page for logged-out users                        |
| `searchResults.tsx`   | Search results page                                                |
| `bookInfo.tsx`        | Book detail — status, rating, review, progress, recommendations    |
| `profile.tsx`         | User profile — book shelves, stats                                 |
| `shelves.tsx`         | Book shelves view                                                  |
| `comments.tsx`        | Comments/reviews section                                           |
| `feed.tsx`            | Activity feed (friends/all/tracking tabs)                          |
| `readingStats.tsx`    | Reading stats by year                                              |
| `settings.tsx`        | Account settings / delete account                                  |
| `explore.tsx`         | Explore hub (genres + authors)                                     |
| `genres.tsx`          | Genre directory                                                    |
| `genreBooks.tsx`      | Books filtered by genre (paginated)                                |
| `genreEmoji.ts`       | Genre → emoji mapping                                              |
| `authorBooks.tsx`     | Books filtered by author (paginated)                               |
| `authorDirectory.tsx` | Author directory                                                   |
| `import.tsx`          | Import page with SSE progress                                      |
| `library.tsx`         | Personal library — e-reader credentials, upload, book manager      |
| `login.tsx`           | Login form                                                         |
| `signup.tsx`          | Sign up form                                                       |
| `app.tsx`             | iOS app landing page                                               |
| `privacy-policy.tsx`  | Privacy policy                                                     |
| `terms.tsx`           | Terms of service (`/legal`)                                        |
| `pds.tsx`             | PDS info page (`/pds`)                                             |
| `error.tsx`           | Error page                                                         |

### Shared Page Components (`src/pages/components/`)

| File                       | What                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `book.tsx`                 | Book card component                                                                               |
| `BookCard.tsx`             | Composable book card                                                                              |
| `buzz.tsx`                 | Buzz/comment display                                                                              |
| `BookReview.tsx`           | Book review form/display                                                                          |
| `EditableLibraryTable.tsx` | Library table with inline editing                                                                 |
| `ProfileHeader.tsx`        | Profile header with avatar/stats                                                                  |
| `LanguageSelect.tsx`       | Language picker (search/explore filters)                                                          |
| `modal.tsx`                | Modal dialog (CSS-based)                                                                          |
| `fallbackCover.tsx`        | Placeholder book cover                                                                            |
| `AtTags.tsx`               | [AT Tags](https://tangled.org/chrisshank.com/at-tags/) `<meta name="at:...">` builder (see below) |
| `cards/`                   | Sub-components: `Card.tsx`, `CardActions.tsx`, `StarDisplay.tsx`, `UserBlock.tsx`, `index.ts`     |

Inline JS helper: `src/pages/utils/script.ts`

**AT Tags** (`AtTags.tsx`): emits `<meta name="at:...">` tags declaring which
ATProto records/identities a page maps to ([proposal](https://tangled.org/chrisshank.com/at-tags/)).
`Layout` (`src/pages/layout.tsx`) always emits a site-wide `at:me` (the
`BOOKHIVE_DID` constant in `src/constants.ts`, also served at
`/.well-known/atproto-did`) and renders per-page tags from its `atTags?: AtTagsProps`
prop, which routes pass via `c.render(..., { atTags })` (the `ContextRenderer`
type in `src/routes/main.tsx` carries it). Currently set on: book detail
(`at:canonical` → `hive_book.hiveBookAtUri`), profile (`at:author` → DID), and
shelf view (`at:canonical` → list AT URI, `at:author` → owner DID). Built with
hono's `html` template, **not** JSX `<meta>` elements, because hono/jsx dedupes
head `<meta>` tags by `name` and would collapse the proposal's array semantics.

## Client-Side Components (`src/client/`)

6 hydration islands, mounted in `src/client/index.tsx`:

| Component        | Mount Point                        | File                                              |
| ---------------- | ---------------------------------- | ------------------------------------------------- |
| `SearchTrigger`  | `#mount-search-box` (navbar)       | `src/client/components/SearchBox.tsx`             |
| `SearchPalette`  | `#mount-search-palette`            | `src/client/components/SearchPalette.tsx`         |
| `StarRating`     | `#star-rating` (book page)         | `src/client/components/StarRating.tsx`            |
| `ImportTableApp` | `#import-table` (import page)      | `src/client/components/import/ImportTableApp.tsx` |
| `LibraryTable`   | `#mount-library-table` (profile)   | `src/client/components/LibraryTable.tsx`          |
| `LibraryManager` | `#mount-library-manager` (library) | `src/client/components/LibraryManager.tsx`        |

`SearchPalette` takes an optional `onSelectBook` prop: when set it acts as a
book picker (select instead of navigate, no status buttons) — `LibraryManager`
reuses it to link e-reader documents / personal books to hive books.

`LibraryManager` owns the whole library body; its sub-components are in
`src/client/components/library/`: `AnchoredMenu.tsx` (dropdown primitives),
`ShelfTabs.tsx`, `PersonalBookCard.tsx` (grid card), `SyncDocumentSections.tsx`
(triage strip + "Also tracking"), `types.ts`. Personal books and sync documents
share the KOReader partial MD5, so a document with a matching file is folded
into that book's grid card instead of listed separately. `SyncDocuments.tsx` was
removed — `LibraryManager` absorbed it.

`AnchoredMenu`/`MenuItem`/`MenuConfirm` are the house dropdown: no state, no
outside-click listener, built from a `peer` checkbox + `<form>` reset. Prefer it
over writing menu state. Don't switch it to the Popover API or CSS anchor
positioning — both were tried and reverted; the file's header comment says why.

All three library menus (book card, shelf tab, sync document row) use it; reach
for it before writing menu state.

Non-mounted client components: `bookActions.tsx`, `ProgressBar.tsx` (imported by others).

Client hooks/utils:

- `src/client/components/utils/useSearchBooks.ts` — search via XRPC
- `src/client/components/utils/useDebounce.ts` — debounce hook
- `src/client/components/utils/icons.tsx` — SVG icons
- `src/client/utils/debounce.ts`, `throttle.ts` — utility functions

## Data Layer

### Database (`src/db.ts`)

SQLite via Kysely. Schema + all migrations (001–021) in one file. `createDb`
sets WAL/perf PRAGMAs (**`mmap_size` defaults to 0** — see `DB_MMAP_SIZE` in
`src/env.ts`; mapping a 1.6 GB database into every worker moved RSS by 971 MB
per full-table scan and cost ~1 GB of the cgroup's budget plus reclaim thrash,
to save ~390ms); migrations run with fsync disabled and a background
`VACUUM` on startup. Exports `BookFields` (select list) and
`syncHiveBookGenres()`.

Kysely talks to `bun:sqlite` through `src/bun-sqlite-kysely.ts`. Its
`isReaderStatement()` must return true for anything that produces rows —
`SELECT` and `... RETURNING` — or those queries silently come back empty. It also
rewrites Kysely's bare `begin` to **`BEGIN IMMEDIATE`** (`toImmediateTransaction`):
a deferred transaction that later upgrades to a write fails with
`SQLITE_BUSY_SNAPSHOT`, and the busy handler is never consulted for that case, so
`PRAGMA busy_timeout` alone cannot cover it across cluster processes. See
`src/bun-sqlite-kysely.test.ts`.

| Table              | Purpose                   | Key columns                                                                                                                                                              |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_book`        | User's book records       | uri (PK), cid, userDid, hiveId, title, authors, status, **stars**, review, startedAt, finishedAt, **owned**, bookProgress, previousReads (JSON re-read history)          |
| `hive_book`        | Canonical book data       | id (HiveId, PK), title, authors (**tab-separated**), cover, thumbnail, description, rating, ratingsCount, series, meta, enrichedAt, identifiers, hiveBookAtUri, language |
| `hive_book_genre`  | Genre-to-book mapping     | hiveId, genre (UNIQUE pair). **Genres live ONLY here** — the old `hive_book.genres` column was dropped (mig 011)                                                         |
| `hive_book_fts`    | FTS5 search index         | External-content FTS5 over `hive_book(title, rawTitle, authors)`, trigger-maintained (mig 019). Never written directly                                                   |
| `hive_book_author` | Author-to-book mapping    | hiveId, author, position (PK hiveId+author). `authors` split on tabs, trigger-maintained (mig 020). `position = 0` is the credited first author                          |
| `book_id_map`      | ISBN/Goodreads cross-refs | hiveId (PK), isbn, isbn13, goodreadsId, updatedAt                                                                                                                        |
| `buzz`             | Comments on books         | uri (PK), cid, userDid, hiveId, **comment**, bookUri, parentUri, createdAt                                                                                               |
| `user_follows`     | Cached follow graph       | userDid, followsDid, followedAt, syncedAt, **isActive**                                                                                                                  |
| `book_list`        | User-created book lists   | **uri (PK, AT URI)**, cid, userDid, name, description, ordered, tags, createdAt                                                                                          |
| `book_list_item`   | Items in a book list      | **uri (PK, AT URI)**, cid, userDid, **listUri**, hiveId, position, embeddedTitle/Author/CoverUrl, identifiers                                                            |
| `sync_document`    | E-reader sync progress    | id (PK), userDid, provider, documentHash (UNIQUE per user+provider), hiveId (nullable), filename, title, authors, progressData (JSON), createdAt, updatedAt              |
| `enrich_queue`     | Pending Goodreads enrich  | **hiveId (PK — the dedupe)**, enqueuedAt, attempts, nextAttemptAt, claimedAt, lastError                                                                                  |

`hive_book.enrichAttempts` / `enrichFailedAt` (mig 021) are the queue's terminal
state. **The queue could not converge before them**: a row at `MAX_ATTEMPTS` was
deleted without recording anything on the book, and `enrichedAt` is only set on
success — so the next page view re-enqueued it. With a crawler walking all 356k
books that is a perpetual-motion machine (12,444 rows, +20/min, and _zero_ rows
ever observed at max attempts because they were deleted and re-added instead).
`enqueueEnrichmentBatch` now filters books stamped within
`ENRICH_RETRY_AFTER_MS` (7d) **inside the function**, not at each call site —
every caller is a crawler-reachable read path, so one shared gate is the only
version that can't regress when a call site is added. It's a cooldown rather
than a tombstone: most failures are Goodreads' WAF being up, which is transient.

Notes: `user_book` has no `rating` column (it's `stars`); `owned` is a boolean
column, **not** a status (legacy `…#owned` status migrated to `owned=1`).
`previousReads` (mig 015) is a JSON array of re-read history entries
(`{ startedAt?, finishedAt }`), serialized by `hydrateUserBook`/
`serializeUserBook` alongside `bookProgress`. Sync inflows persist any
`previousReads` array present on incoming `buzz.bookhive.book` records: the
ingester (`src/bsky/ingester.ts`) writes it, as do the re-sync route handlers
`refetchBooks` (`src/routes/lib.ts`) and the admin PDS export/resync handler
(`src/routes/admin.ts`). The local POST `/books/:hiveId` route and the import
UI do not expose `previousReads` as user input (absent from their form
schemas), and imports never synthesize it. The one local write that ever grows
it is the server-side re-read rotation in `updateBookRecord`
(`src/utils/getBook.ts`), which archives the prior finished dates into
`previousReads` when a finished book is marked "Reading" again.
`book_list*` are keyed by AT URI (`uri`/`listUri`), not numeric ids.

### KV Cache (`src/sqlite-kv.ts`)

SQLite-backed unstorage for: profiles, identity resolution, search results, auth sessions/state, follows sync timestamps, sync pending PDS writes, cached anonymous pages (`page:`), and rendered OG cards (`og:`).

**The KV is VACUUMed on startup** by the primary worker (`vacuumKvIfBloated`),
gated on a 25% free-page ratio, and switched to `auto_vacuum = INCREMENTAL` so
the 15-minute sweep can reclaim as it goes (`incrementalVacuumKv`). It is a
delete-heavy workload — both caches churn and both are swept — but nothing ever
vacuumed it and `auto_vacuum` was never set: measured 2026-08-02 at **1.94 GB on
disk holding 34.7 MB of live rows, 98.1% free pages**, i.e. 1.9 GB of page-cache
pressure inside a memory-limited cgroup for nothing. A full VACUUM of that file
took 1.36s, cheap enough to run on every deploy.

### Key Data Utilities

| File                                                                                                                           | Purpose                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/utils/getBook.ts`                                                                                                         | Book record CRUD against user's PDS                                          |
| `src/utils/getProfile.ts`                                                                                                      | Profile fetching from Bluesky                                                |
| `src/utils/getFollows.ts`                                                                                                      | Follow graph sync                                                            |
| `src/utils/enrichBookData.ts`                                                                                                  | Goodreads enrichment (semaphore-bounded, 45s deadline)                       |
| `src/utils/enrichQueue.ts`                                                                                                     | `enrich_queue` producer + primary-worker drain (see below)                   |
| `src/utils/semaphore.ts`                                                                                                       | Async concurrency limiter + `withTimeout`                                    |
| `src/utils/circuitBreaker.ts`                                                                                                  | Three-state breaker (used by the WAF solver)                                 |
| `src/utils/bookIdentifiers.ts`                                                                                                 | ISBN/ID normalization + persistence                                          |
| `src/utils/bookProgress.ts`                                                                                                    | BookProgress serialization                                                   |
| `src/utils/readThroughCache.ts`                                                                                                | KV read-through with TTL                                                     |
| `src/utils/csv.ts`                                                                                                             | Goodreads/StoryGraph CSV parsers                                             |
| `src/utils/lists.ts`                                                                                                           | Book list (shelf) CRUD against PDS                                           |
| `src/utils/readingStats.ts`                                                                                                    | Reading stats aggregation by year                                            |
| `src/utils/catalogBookService.ts`                                                                                              | Catalog backfill (admin)                                                     |
| `src/utils/deleteAccount.ts`                                                                                                   | Account data deletion                                                        |
| `src/utils/dbExport.ts`                                                                                                        | Sanitized DB/KV export (admin)                                               |
| `src/utils/manifest.ts`                                                                                                        | Vite manifest → asset URLs                                                   |
| `src/utils/getLanguages.ts`                                                                                                    | Language list/normalization                                                  |
| `src/utils/importBook.ts`                                                                                                      | Import a single book record                                                  |
| `src/utils/authorMatching.ts`                                                                                                  | Author name matching                                                         |
| `src/utils/generateInitialsAvatar.ts`                                                                                          | SVG initials avatar                                                          |
| `src/utils/syncMatching.ts`                                                                                                    | KOReader document → BookHive book matching (exact); `NO_HIVE_MATCH` sentinel |
| `src/utils/syncBridge.ts`                                                                                                      | Bridge e-reader progress → user_book + queue PDS write                       |
| `src/utils/personalLibrary.ts`                                                                                                 | Personal library file paths, `MAX_PERSONAL_BOOK_BYTES`, `streamPersonalBook` |
| `src/utils/ogCache.ts`                                                                                                         | Shared KV cache for rendered OG cards + sweep stats                          |
| `src/utils/ftsQuery.ts`                                                                                                        | Builds FTS5 MATCH expressions from free-text search input                    |
| `src/utils/htmlToText.ts`, `batchTransform.ts`, `lazy.ts`, `hiveBookGenres.ts`, `ensureBookCataloged.ts`, `uploadImageBlob.ts` | misc helpers                                                                 |

## Types (`src/types.ts`)

All shared TypeScript types: `HiveId`, `UserBook`, `HiveBook`, `Buzz`, `BookProgress`, `SearchResult`, `SyncDocumentRow`, `SyncProgressData`, etc.

Constants: `src/constants.ts` — book status enums and display maps.

## AT Protocol / Bluesky

| File                      | Purpose                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/bsky/ingester.ts`    | Jetstream firehose — ingests book/buzz records from all users (runs in `ingester-worker` thread) |
| `src/bsky/id-resolver.ts` | DID/handle resolution with caching                                                               |
| `src/bsky/bookLookup.ts`  | Book identifier lookup + transformation                                                          |
| `src/bsky/lexicon/`       | Generated types + validators (`generated/`) from lexicon schemas                                 |
| `src/xrpc/router.ts`      | `createXrpcRouter` — all `/xrpc/*` methods (see below)                                           |
| `lexicons/*.json`         | AT Protocol lexicon definitions (~27 files)                                                      |
| `lex.config.ts`           | Lexicon codegen config (`bun run lexgen`)                                                        |

### Records / collections

- Books: `buzz.bookhive.book`; buzzes/comments: `buzz.bookhive.buzz`.
- Lists reuse the **popfeed** collections: `social.popfeed.feed.list`,
  `social.popfeed.feed.listItem` (only items with `creativeWorkType === "book"`).
- Follows write `app.bsky.graph.follow`.

### XRPC methods (`src/xrpc/router.ts`)

Built on `@atcute/xrpc-server`; request context is passed via `AsyncLocalStorage`
(`xrpcContextStorage`) from the Hono `ctx`. Ratings are transported as integers
scaled ×10. Queries: `searchBooks`, `listGenres`, `getBookIdentifiers`,
`getBook`, `getProfile`, `getLanguages`, `getExplore`, `getFeed`,
`getAuthorBooks`, `getReadingStats`, `getUserLists`, `getList`. Auth-required
list procedures: `createList`, `updateList`, `deleteList`, `addToList`,
`removeFromList`, `reorderList` (delegate to `src/utils/lists.ts`).

**Personal library** (all auth-required, all server-local — no PDS writes).
Queries: `getPersonalLibrary`, `getPersonalBook`, `getSyncProgress`,
`listSyncDocuments`. Procedures: `uploadPersonalBook`, `deletePersonalBook`,
`linkPersonalBook`, `unlinkPersonalBook`, `putSyncProgress`,
`createPersonalShelf`, `updatePersonalShelf`, `deletePersonalShelf`,
`addToPersonalShelf`, `removeFromPersonalShelf`.

`getPersonalLibrary` returns `{ books, total, cursor? }`; each book carries
`progress` (joined from `sync_document`) and `shelfIds`. `linkPersonalBook`
**overwrites** the file's `title`/`authors` from the hive book and propagates the
`hiveId` onto the matching `sync_document`; `unlinkPersonalBook` clears both.

## Scrapers (`src/scrapers/`)

| File               | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `goodreads.ts`     | Search API scraper                             |
| `moreInfo.ts`      | Goodreads page scraper (genres, series, meta)  |
| `getHiveId.ts`     | HiveId generation (hash of title+author)       |
| `languageNames.ts` | Language name normalization                    |
| `index.ts`         | `findBookDetails` entry point                  |
| `waf/`             | AWS WAF challenge solver (see `waf/README.md`) |

**The WAF solver is load-bearing, and its breaker currently starves the path
that works.** Over 7 days it produced 356 direct successes plus 2,023
`cached_token` successes — a warm token only exists because a solve produced it
— so ~24% of the 9,724 successful enrichments in that window depended on it. Do
not remove it on the strength of a short sample: a 60-minute window on
2026-08-02 contained zero solver successes and is not representative.

It _is_ degrading, though. Over the most recent 24h: 10,654 attempts, **zero**
successes, 10,502 `waf_token_ineffective`. And `fetchGoodreadsViaWaf`
(`solver.ts`) accounts every one of those to the **single** breaker that also
gates the cheap plain-HTTP attempt made first inside the worker
(`if (result.html) recordSuccess() else recordFailure()`). With
`consecutiveFailureThreshold: 5` and a 15-minute cooldown, a solver having a bad
week blocks plain HTTP — which still succeeded 4,671 times in that same 24h.
That is the 11,668 `circuit_open`. Splitting the accounting (one breaker for the
plain fetch, one for the solve) is the open fix.

`google.ts` and `isbndb.ts` were deleted (2026-08-02) — dead code behind
commented-out imports with no fallback branch in `findBookDetails`.
`images.isbndb.com` stays in the `imageProxy` allowlist: historical `hive_book`
rows still point there.

## Auth (`src/auth/`)

| File               | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `router.tsx`       | Login/logout/OAuth callback routes                                     |
| `client.ts`        | OAuth client creation                                                  |
| `storage.ts`       | Session/state stores (unstorage-backed) + `getStoredSessionIssuerHost` |
| `handle.ts`        | Handle validation                                                      |
| `refresh-lock.ts`  | Cross-process token-refresh lock (SQLite `auth_refresh_lock`)          |
| `restore-guard.ts` | Per-PDS timeout + circuit breaker around `oauthClient.restore()`       |

**A dead PDS must never reach the event loop.** `oauthClient.restore()` had no
timeout. On 2026-08-01/02 one user's PDS started blackholing packets, the
refresh hung while holding the cross-process lock (whose heartbeat renewed it,
so it was never evicted as stale), and every other request for that DID — in
every worker — burned the lock's full 37.5s poll budget, three synchronous
SQLite statements per poll. Workers stopped calling `accept()`; Caddy logged
166,450 `dial tcp: i/o timeout`, the dominant class of the outage's 171,145
502s. Now:

- `guardedRestore` (`restore-guard.ts`) wraps every restore in a 5s
  `withTimeout` and a `CircuitBreaker` keyed by the **authorization-server
  host**, read from the stored session's `tokenSet.iss` via
  `getStoredSessionIssuerHost` — a local KV read, never a network call. Once a
  host trips, requests fail instantly instead of dispatching.
- `refresh-lock.ts` waits `MAX_WAIT_MS` (3s) with exponential backoff rather
  than 250 × a flat 150ms, cutting a full wait from ~750 SQLite statements to
  ~21.
- `getSessionAgent` only calls `session.destroy()` when
  `isSessionTerminatingError` says the PDS actually rejected our credentials. A
  timeout used to silently log the user out.
- Wide events carry `pds_host`, `pds_breaker`, `oauth_restore_ms` and
  `oauth_restore_terminal`. Regression tests: `src/auth/pds-outage.test.ts`.

## Middleware (`src/middleware/`)

Applied globally in `src/app.ts`: timing, context, wide-event logging, error capture, asset URLs, secure headers, compression, JSX renderer, OpenTelemetry, Prometheus.

**Tracing goes app → OpenObserve directly** (`server/plugins/otel-sdk.ts`),
at `${OPEN_OBSERVE_URL}/api/bookhive/v1/traces`. `OPEN_OBSERVE_URL` must be
**container-reachable** (`http://openobserve:5080` on the `backbone` network) —
inside the server container `localhost` is the app itself. compose.yaml carried
`localhost` while the deployment used `openobserve`, and that mismatch is how
the pipeline was once wrongly written off as dead; it is live, with 13.7M spans
in `traces/default`. The otel-collector handles **metrics only** (a prometheus
receiver scraping `bookhive:8080`), so it is not in the trace path.

Two spans per request: a nitro root span (`server/plugins/request-tracing.ts`,
which also emits `Server-Timing: root;dur=…`) and a hono route span
(`src/middleware/otel-middleware.ts`). The route span is renamed **after**
`next()` to `METHOD /matched/:route` — it used to be literally
`"hono-middleware"` for every request, which made 82.6% of spans share one name
and defeated grouping entirely. `getNodeAutoInstrumentations()` is configured
rather than bare: `instrumentation-fs` off (a span per filesystem op) and
inbound HTTP suppressed (the two spans above already cover it); outbound HTTP
stays on, since a PDS that stops answering is exactly what the incidents were
about.

`src/middleware/sync-auth.ts` — KOSync auth middleware (validates `x-auth-user`/`x-auth-key` headers, resolves handle → DID, verifies `md5(derived password)`). Also exports `deriveSyncPassword()`, `currentSyncPassword()`, `getSyncTokenVersion()`, and `rotateSyncToken()` used by the Settings page.

## Styling

- **Tailwind CSS v4** with `@tailwindcss/forms` and `tailwindcss-animated` plugins
- Config: `tailwind.config.js` — custom `yello` color palette
- PostCSS: `postcss.config.js`
- Entry: `src/index.css`
- CSS-only interactivity patterns: peer/checked selectors for tabs, dropdowns, modals

## Build & Dev

| Command             | What                                                         |
| ------------------- | ------------------------------------------------------------ |
| `bun run dev`       | Dev server (`vp dev`)                                        |
| `bun run build`     | Production build (`lexgen` + `vp build`) → `.output/server/` |
| `bun run start`     | Run built server (`bun run .output/server/index.mjs`)        |
| `bun test`          | Run tests (`bun test src server`)                            |
| `bun run typecheck` | `vp lint --type-aware --type-check` + `vp fmt --write`       |
| `bun run lint`      | Same as typecheck (oxlint/oxfmt via vp, **not** tsc)         |
| `bun run format`    | `vp fmt`                                                     |
| `bun run lexgen`    | Regenerate AT Protocol XRPC types from lexicons (`lex-cli`)  |
| `bun run seed:db`   | Seed/initialize the DB (`src/initialize.ts`)                 |

Build pipeline: **Vite+ (vite-plus)** wrapping Vite 8 + Rolldown + Nitro
(`nitro-nightly`, preset `bun`), Nitro server entry at `./server/server.ts` with
otel/request-tracing plugins. Production builds swap the preset's runtime entry
for `./server/entry.bun.mjs` (adds `reusePort: true`; build-only via the
function-form `defineConfig` — dev keeps the nitro-dev entry). The Docker CMD
is `bun run cluster.ts` (copied from `server/cluster.ts`, **with
`server/worker-exit.ts` alongside it** — cluster.ts imports it at runtime), not the raw
`.output/server/index.mjs`, under `ENTRYPOINT ["/sbin/tini", "--"]` — the
supervisor is PID 1 and Bun has no `waitpid`, so without an init shim every
HEALTHCHECK `wget` leaks a zombie (`init: true` in `compose.yaml` is the same
fix from the other direction). `cluster.ts` logs a JSON `worker_exit` line with
`signal`/`likely_oom`/`pid` plus the worker's last `rss_kb`/`anon_kb`, which is
how a cgroup OOM kill becomes visible in app logs at all — the container's
`RestartCount` stays 0 through every one of them.
`classifyWorkerExit` lives in `server/worker-exit.ts` so it can be tested
(`bun test src server`; `bunfig.toml`'s test root used to be `src`, which made
`server/` untestable — that is how `signalName` shipped a number-keyed lookup
against Bun's _string_ `signalCode`, emitting `"SIGSIGKILL"` and a permanently
false `likely_oom` through ~148 OOM kills). Memory is sampled from
`/proc/<pid>/smaps_rollup` every 15s while workers are alive, because procfs is
already gone by the time `onExit` fires. Vite plugins: `bunRuntimeExternal()`,
`devImageProxyPassthrough()`, `tailwindcss()`, `standaloneBundles()`, `nitro()`.
The client bundle entry is `src/client/index.tsx`; assets emitted to
`assets/[name]-[hash]` with a build manifest (read via `src/utils/manifest.ts`).
The `standaloneBundles()` plugin shells out to `bun build` for 4 worker entry
points into `.output/server/workers/`: `ingester-worker.js`,
`open-observe-worker.js`, `og-render-worker.js`, `import-worker.js`. (There were
5; the WAF solver worker was deleted — see Scrapers.) Path alias
`@` → `./src`. Runtime requires `bun >= 1.3.14`. TypeScript type checking via
**tsgo** (TypeScript 6.x / Go-native compiler); linting via **oxlint** and
formatting via **oxfmt**, both accessed through the `vp` CLI. Pre-commit hook
(`.vite-hooks/pre-commit`) runs `vp staged` → `vp check --fix`.

Notable deps: hono, kysely, zod 4, iron-session, unstorage + ocache, `@atcute/*`
(atproto client/oauth/jetstream/identity), `@takumi-rs/image-response` + React 19
(OG image render only), pino + `@hono/prometheus` + `@opentelemetry/*`,
basecoat-css, envalid (env validation in `src/env.ts`).

## iOS App (`app/`)

Separate Expo/React Native workspace with its own reference doc,
`app/ARCHITECTURE.md` — update that file, not this one, when changing app
screens, hooks, or components. Not relevant for web UI refactor.

The app consumes the personal-library and KOSync surfaces: the XRPC
`*PersonalBook` / `*PersonalShelf` methods, the REST `/library/shelves`,
`/library/sync/*` and `/settings/sync/*` routes, and the content-negotiated
`POST /library/upload`. Changes to any of those are app-visible.

## Workers, Logging & Observability

| Path                                 | Purpose                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/workers/ingester-worker.ts`     | Wraps `src/bsky/ingester.ts`; runs Jetstream ingest off-thread                                        |
| `src/workers/og-render/`             | OG image render worker (React + `@takumi-rs/image-response`)                                          |
| `src/workers/open-observe-worker.ts` | pino transport → OpenObserve log shipping                                                             |
| `src/workers/import/`                | CSV import processing worker (`index.ts`, `logic.ts`, tests)                                          |
| `src/logger/index.ts`                | pino logger (`getLogger`/`destroyLogger`); redacts cookies                                            |
| `src/metrics.ts`                     | Prometheus metrics (durations, active ops, per-worker memory) — see below                             |
| `src/pds/client.ts`                  | Self-hosted PDS support                                                                               |
| `./server/`                          | Nitro server entry + plugins (`request-tracing.ts`, `html-cache-headers.ts`) — separate from `src/`   |
| `./server/entry.bun.mjs`             | Custom Nitro bun runtime entry (adds SO_REUSEPORT); prod builds only                                  |
| `./server/cluster.ts`                | Multi-process supervisor (Docker CMD) — spawns `WEB_CONCURRENCY` workers                              |
| `./server/worker-exit.ts`            | Pure exit classification + procfs memory read, used by `cluster.ts` (copied into the image beside it) |

Each worker is bundled standalone into `.output/server/workers/` (see Build &
Dev). The ingester worker posts `wideEvent`/`ready` messages back to the main
thread's pino logger.

**Measure `Anonymous`, not `Rss`.** Every per-worker RSS reading includes the
clean, shared, file-backed SQLite mmap (`PRAGMA mmap_size`, `src/db.ts`), which
is reclaimable and can swing ~1 GB as a full-table scan faults it in — that term
is what made the 2026-08 investigation chase a "balloon rotating between
workers" that was never the leak. `/debug/memory` separates them.

Metrics conventions in `src/metrics.ts`:

- Per-process series (memory, CPU, event-loop lag) carry a `worker` label from
  `WORKER_INDEX`. Without it the SO_REUSEPORT workers alias into one time series
  that silently alternates between processes. Deliberately **not** `pid` — with
  workers restarting, a pid label would mint a new series each time; the pid is
  on `/debug/memory` instead.
- `bookhive_process_memory_bytes` exports `external` and `array_buffers`
  alongside `rss`/`heap_*`. Native, off-heap bytes are where this app's
  unbounded allocations actually live, and they were unmeasured through the
  whole incident. Under Bun `heap_total`/`heap_used` are JSC values —
  `heap_used > heap_total` is normal and is **not** a labelling bug.
- Cluster-wide gauges (`bookhive_enrich_queue_depth`, `bookhive_og_cache_*`)
  describe shared SQLite state and are published by the primary worker only, so
  they are never triple-counted.
- An empty metric family emits its `# HELP`/`# TYPE` header and no samples.
  The old `name 0` placeholder published an unlabelled sample for metrics whose
  real samples are labelled, which Prometheus rejects as an inconsistent label
  set.

## Context & Session (`src/context.ts`)

`AppContext` — singleton app deps: `db`, `kv`, `ingester`, `oauthClient`,
`resolver`/`baseIdResolver` (DID/handle), `getSessionDid()` (fast cookie-only
DID), `getSessionAgent()` (OAuth `SessionClient`), `getProfile()`,
`serviceAccountAgent` (for `@bookhive.buzz` writes, when
`BOOKHIVE_SERVICE_HANDLE`/`BOOKHIVE_APP_PASSWORD` set), `addWideEventContext`.

Hono context vars (`c.get`): `ctx`, `assetUrls`, `requestId`, `wideEventBag`,
`appLogger`, `requestError`.

`createAppDeps()` builds the logger, DB (+migrate +background VACUUM — primary
worker only), the shared KV (single SQLite connection, unstorage mounts:
`search:` (in-memory LRU), `profile:`, `identity:`, `follows_sync:`,
`auth_session:`, `auth_state:`, `book_lock:` (SQLite — shared across worker
processes; readers treat rows >60s old as stale), `sync_pending:` /
`sync_token:` (SQLite — KOSync deferred PDS writes + per-user token rotation
counter), `page:` (SQLite — anon page
cache)), OAuth client, caching ID resolvers, and (primary only) spawns the
ingester worker and starts the enrichment drain (`stopEnrichmentDrain` on the
deps is called from `src/server.ts`'s shutdown). Sessions use
`iron-session` (180-day cookie) with an in-memory `SessionClient` cache and
auto token refresh; cached clients are wrapped so a
"session was deleted by another process" refresh failure (another cluster
process rotated it first) evicts the entry, re-restores once and retries instead
of 500ing. `getProfile` is read-through cached (`profile:` + did, 24h
revalidate / 30d TTL). `createContextMiddleware(deps)` wires per-request `ctx`
with lazy session/DID/profile resolution.
