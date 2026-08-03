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

Worker threads (src/workers/, bundled to .output/server/workers/):
  ingester-worker     — Jetstream firehose ingest
  og-render-worker    — OG image generation (React + takumi)
  open-observe-worker — pino log shipping to OpenObserve
  import-worker       — CSV import processing
```

**Key patterns:**

- Server components (`src/pages/`) render full HTML. Only 6 islands are hydrated client-side (`src/client/`). Most interactivity is CSS-only (peer/checked selectors) or inline `<Script>` vanilla JS.
- **Production is multi-process**: `server/cluster.ts` spawns `WEB_CONCURRENCY` (default 4) workers sharing port 8080 via SO_REUSEPORT. Worker 0 is the **primary** (`isPrimaryWorker`): only it runs migrations, VACUUM, the Jetstream ingester, and the enrichment drain.
- **Enrichment is queued, never inline**: routes call `enqueueEnrichment`/`enqueueEnrichmentBatch` (`src/utils/enrichQueue.ts`). The primary worker drains it every 5s at concurrency 3, with exponential backoff. `enrichBookWithDetailedData` holds its own semaphore (4) + 45s deadline.
- **Author lookups use `hive_book_author` join** (mig 020), not `LIKE`. This is exact identity, not text search.
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

| File                   | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `src/index.ts`         | Bun.serve — HTML bundle route + Hono fetch handler                  |
| `src/server.ts`        | Wires deps via `createAppDeps()` + `createApp()`; graceful shutdown |
| `src/app.ts`           | Hono app factory — all middleware + route mounting                  |
| `src/entry.html`       | Bun HTML bundle entry (imports CSS + client JS)                     |
| `src/client/index.tsx` | Client bundle entry — mounts 6 hydrated components                  |

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
`{ notModified: true }` before it opens the file; both download routes turn that
into a 304. Without it an e-reader re-downloads every book on every sync.

**Anonymous page cache** (`src/middleware/anon-page-cache.ts`): serves GET requests without a `sid` cookie on `/books/*`, `/explore*`, `/authors/*` from KV (gzipped HTML, 1h TTL). Prod-only.

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
- `/admin/*` → `src/routes/admin.ts` (gated by `EXPORT_SHARED_SECRET`)
- `/debug/*` → `src/routes/debug.ts` (gated by `EXPORT_SHARED_SECRET`)
- `/import` (POST `/goodreads`, `/storygraph`) → `src/routes/import.ts` — CSV import handler

### Mounted in `src/app.ts` (after `mainRouter`)

- `/sitemap.xml` → static sitemap

### Standalone pages in `src/routes/main.tsx`

- `/privacy-policy` → `src/pages/privacy-policy.tsx`
- `/legal` → `src/pages/terms.tsx`
- `/pds` → `src/pages/pds.tsx` (redirects to `/` if PDS disabled)
- `/` → `src/pages/marketing.tsx` — landing; always renders regardless of auth state (logged-in users navigate to `/home` via sidebar)
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
- `/explore` → `src/pages/explore.tsx` — explore hub
- `/explore/genres` → `src/pages/genres.tsx`; `/explore/genres/:genre` → `src/pages/genreBooks.tsx`
- `/explore/authors` → `src/pages/authorDirectory.tsx`
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
- POST `/` → add/update book (zValidator form); per-DID `book_lock` KV, 429 if locked
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
- POST `/upload` → multipart upload (validates format, computes KOReader partial MD5, parses metadata, auto-links matching `sync_document`). Content-negotiated: JSON for mobile, 302 for browser. Size checked before `arrayBuffer()`.
- GET `/covers/:hash` → cover image; GET `/books/:hash/download` → file download (shares `streamPersonalBook` with OPDS)
- GET `/shelves` → JSON shelf list with counts
- GET `/sync/password`, POST `/sync/rotate` → KOSync password (duplicated from settings)
- GET `/sync/documents`, POST `/sync/link`, POST `/sync/dismiss`, POST `/sync/rename`, POST `/sync/delete`

### `src/routes/api.tsx` (mounted at `/api`)

- POST `/update-book`, `/update-comment`
- POST `/follow`, `/follow-form`, `/unfollow`, `/unfollow-form`

### `src/routes/rss.ts` (mounted at `/rss`)

- GET `/user/:handle`, `/book/:hiveId`, `/friends/:handle` → RSS 2.0 feeds

### `src/routes/opds.ts` (mounted at `/opds`) — e-reader catalog

Serves personal library to e-readers. Auth via `src/middleware/opds-auth.ts` (HTTP Basic, same derived password as KOSync). **Dual-format**: OPDS 1.2 XML or 2.0 JSON based on `Accept` header.

- GET `/` → root navigation feed
- GET `/all`, `/shelves/:id`, `/search/results` → acquisition feeds (paginated at 24)
- GET `/search` → OpenSearch description. Accepts both `q` and `query` params.
- GET `/books/:hash/download`, `/books/:hash/cover`

### `src/routes/og.tsx` (mounted at `/og`) — OG images

- `/marketing`, `/book/:hiveId`, `/profile/:handle`, `/profile/:handle/stats/:year`, `/author/:author`, `/genre/:genre`, `/app` → `image/webp`

Failed renders serve `public/og-fallback.png` at 200, never 500. `renderOnce` deduplicates concurrent requests for the same card. **No server-side OG cache** — Cloudflare is the cache. Do not add one without measuring the repeat rate (historically ~4%).

### `src/routes/sync/kosync.ts` (mounted at `/kosync`) — KOReader sync

Auth: `x-auth-user` (handle) + `x-auth-key` (md5 of HMAC-derived password). Progress stored in `sync_document`, bridged to `user_book.bookProgress`. Deferred PDS writes queued in KV and flushed when a session agent is available.

- POST `/users/create` → 403 (directs to BookHive Settings)
- GET `/users/auth` → validate credentials
- PUT `/syncs/progress` → push progress; GET `/syncs/progress/:document` → pull progress
- GET `/syncs/documents` → list all synced documents

### Shared route helpers

`src/routes/lib.ts` — `cacheControl`, `searchBooks`, `ensureBookIdentifiersCurrent`, `refetchBooks`, `refetchBuzzes`, `refetchLists`, `syncFollowsIfNeeded`.

## Server-Side Pages (`src/pages/`)

Each file exports a Hono JSX component rendered server-side.

| File                  | Renders                                           |
| --------------------- | ------------------------------------------------- |
| `layout.tsx`          | HTML shell — meta tags, assets, `<head>`/`<body>` |
| `navbar.tsx`          | Top nav bar with user menu, search mount point    |
| `simple-navbar.tsx`   | Simplified nav bar variant                        |
| `sidebar.tsx`         | Sidebar layout component                          |
| `home.tsx`            | Authenticated home page                           |
| `marketing.tsx`       | Marketing landing (auth-independent)              |
| `searchResults.tsx`   | Search results                                    |
| `bookInfo.tsx`        | Book detail                                       |
| `profile.tsx`         | User profile + shelves                            |
| `shelves.tsx`         | Book shelves view                                 |
| `comments.tsx`        | Comments/reviews                                  |
| `feed.tsx`            | Activity feed                                     |
| `readingStats.tsx`    | Reading stats by year                             |
| `settings.tsx`        | Account settings                                  |
| `explore.tsx`         | Explore hub                                       |
| `genres.tsx`          | Genre directory                                   |
| `genreBooks.tsx`      | Books by genre (paginated, sortable)              |
| `genreEmoji.ts`       | Genre → emoji mapping                             |
| `authorBooks.tsx`     | Books by author (paginated)                       |
| `authorDirectory.tsx` | Author directory                                  |
| `import.tsx`          | CSV import page                                   |
| `library.tsx`         | Personal library                                  |
| `login.tsx`           | Login form                                        |
| `signup.tsx`          | Sign up form                                      |
| `app.tsx`             | iOS app landing                                   |
| `privacy-policy.tsx`  | Privacy policy                                    |
| `terms.tsx`           | Terms of service (`/legal`)                       |
| `pds.tsx`             | PDS info page                                     |
| `error.tsx`           | Error page                                        |

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

The other 16 `public/screenshots/*.png` (~6.6 MB) are referenced nowhere in the codebase; they
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

| Component        | Mount Point              | File                                              |
| ---------------- | ------------------------ | ------------------------------------------------- |
| `SearchTrigger`  | `#mount-search-box`      | `src/client/components/SearchBox.tsx`             |
| `SearchPalette`  | `#mount-search-palette`  | `src/client/components/SearchPalette.tsx`         |
| `StarRating`     | `#star-rating`           | `src/client/components/StarRating.tsx`            |
| `ImportTableApp` | `#import-table`          | `src/client/components/import/ImportTableApp.tsx` |
| `LibraryTable`   | `#mount-library-table`   | `src/client/components/LibraryTable.tsx`          |
| `LibraryManager` | `#mount-library-manager` | `src/client/components/LibraryManager.tsx`        |

`LibraryManager` sub-components in `src/client/components/library/`: `AnchoredMenu.tsx`, `ShelfTabs.tsx`, `PersonalBookCard.tsx`, `SyncDocumentSections.tsx`, `types.ts`.

**`AnchoredMenu`/`MenuItem`/`MenuConfirm`** are the house dropdown: no state, `peer` checkbox + `<form>` reset. Don't switch to Popover API or CSS anchor positioning (both tried and reverted). All library menus use it.

Other client components: `bookActions.tsx`, `ProgressBar.tsx`.
Client hooks/utils: `useSearchBooks.ts`, `useDebounce.ts`, `icons.tsx`, `debounce.ts`, `throttle.ts`.

## Data Layer

### Database (`src/db.ts`)

SQLite via Kysely. Schema + all migrations (001–021) in one file. `createDb` sets WAL/perf PRAGMAs. `mmap_size` defaults to 0 (see `DB_MMAP_SIZE` in `src/env.ts`). Kysely talks to `bun:sqlite` through `src/bun-sqlite-kysely.ts`, which rewrites `begin` to `BEGIN IMMEDIATE` (deferred transactions fail with `SQLITE_BUSY_SNAPSHOT` across cluster processes).

| Table                 | Purpose                   | Key columns                                                                                                                                                                                              |
| --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_book`           | User's book records       | uri (PK), userDid, hiveId, title, authors, status, **stars** (not `rating`), review, startedAt, finishedAt, **owned** (bool), bookProgress, previousReads (JSON)                                         |
| `hive_book`           | Canonical book data       | id (HiveId, PK), title, authors (**tab-separated**), cover, thumbnail, description, rating, ratingsCount, series, meta, enrichedAt, enrichAttempts, enrichFailedAt, identifiers, hiveBookAtUri, language |
| `hive_book_genre`     | Genre-to-book mapping     | hiveId, genre (UNIQUE pair). **Genres live ONLY here**                                                                                                                                                   |
| `hive_book_fts`       | FTS5 search index         | External-content FTS5 over `hive_book(title, rawTitle, authors)`, trigger-maintained. Never written directly. **Rebuilt after VACUUM** — see below                                                       |
| `hive_book_author`    | Author-to-book mapping    | hiveId, author, position (PK hiveId+author). Trigger-maintained. `position = 0` = first author                                                                                                           |
| `book_id_map`         | ISBN/Goodreads cross-refs | hiveId (PK), isbn, isbn13, goodreadsId, updatedAt                                                                                                                                                        |
| `buzz`                | Comments on books         | uri (PK), userDid, hiveId, **comment**, bookUri, parentUri, createdAt                                                                                                                                    |
| `user_follows`        | Cached follow graph       | userDid, followsDid, followedAt, syncedAt, **isActive**                                                                                                                                                  |
| `book_list`           | User-created book lists   | **uri (PK, AT URI)**, userDid, name, description, ordered, tags, createdAt                                                                                                                               |
| `book_list_item`      | Items in a book list      | **uri (PK, AT URI)**, userDid, **listUri**, hiveId, position                                                                                                                                             |
| `sync_document`       | E-reader sync progress    | id (PK), userDid, provider, documentHash (UNIQUE per user+provider), hiveId (nullable), filename, title, authors, progressData (JSON)                                                                    |
| `enrich_queue`        | Pending Goodreads enrich  | **hiveId (PK — the dedupe)**, enqueuedAt, attempts, nextAttemptAt, claimedAt, lastError                                                                                                                  |
| `personal_book`       | Uploaded ebook files      | contentHash (PK), userDid, filename, title, authors, format, hiveId (nullable), fileSize                                                                                                                 |
| `personal_shelf`      | User's personal shelves   | id (PK, autoincrement), userDid, name, description                                                                                                                                                       |
| `personal_shelf_item` | Books in personal shelves | shelfId, contentHash (PK pair)                                                                                                                                                                           |

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

| File                  | Purpose                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getBook.ts`          | Book record CRUD against user's PDS                                                                                                                                                                                                      |
| `getProfile.ts`       | Profile fetching from Bluesky                                                                                                                                                                                                            |
| `getFollows.ts`       | Follow graph sync                                                                                                                                                                                                                        |
| `enrichBookData.ts`   | Goodreads enrichment (semaphore-bounded, 45s deadline)                                                                                                                                                                                   |
| `enrichQueue.ts`      | `enrich_queue` producer + primary-worker drain. The `exhausted` gauge/heartbeat counts `hive_book.enrichFailedAt` inside the cooldown, **not** queue rows at MAX_ATTEMPTS — those are deleted as they exhaust, so that read was always 0 |
| `semaphore.ts`        | Async concurrency limiter + `withTimeout`                                                                                                                                                                                                |
| `circuitBreaker.ts`   | Three-state breaker                                                                                                                                                                                                                      |
| `bookIdentifiers.ts`  | ISBN/ID normalization + persistence                                                                                                                                                                                                      |
| `bookProgress.ts`     | BookProgress serialization                                                                                                                                                                                                               |
| `readThroughCache.ts` | KV read-through with TTL                                                                                                                                                                                                                 |
| `csv.ts`              | Goodreads/StoryGraph CSV parsers                                                                                                                                                                                                         |
| `lists.ts`            | Book list (shelf) CRUD against PDS                                                                                                                                                                                                       |
| `readingStats.ts`     | Reading stats aggregation by year                                                                                                                                                                                                        |
| `imageProxy.ts`       | imgproxy signing + proxy helper                                                                                                                                                                                                          |
| `personalLibrary.ts`  | Personal library paths, `streamPersonalBook`                                                                                                                                                                                             |
| `bookMetadata/`       | Ebook metadata parsing (epub, mobi, fb2, cbz, cover extraction, KOReader hash)                                                                                                                                                           |
| `bookMeta.ts`         | Book metadata utilities                                                                                                                                                                                                                  |
| `syncMatching.ts`     | KOReader document → BookHive book matching; `NO_HIVE_MATCH` sentinel                                                                                                                                                                     |
| `syncBridge.ts`       | Bridge e-reader progress → user_book + queue PDS write                                                                                                                                                                                   |
| `ftsQuery.ts`         | FTS5 MATCH expression builder                                                                                                                                                                                                            |
| `importBook.ts`       | Import a single book record                                                                                                                                                                                                              |
| `authorMatching.ts`   | Author name matching                                                                                                                                                                                                                     |
| `manifest.ts`         | Vite manifest → asset URLs                                                                                                                                                                                                               |
| `xml.ts`              | XML utilities                                                                                                                                                                                                                            |
| Other                 | `getLanguages.ts`, `catalogBookService.ts`, `deleteAccount.ts`, `dbExport.ts`, `generateInitialsAvatar.ts`, `htmlToText.ts`, `batchTransform.ts`, `lazy.ts`, `hiveBookGenres.ts`, `ensureBookCataloged.ts`, `uploadImageBlob.ts`         |

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
| `lexicons/*.json`         | AT Protocol lexicon definitions (~27 files)                      |
| `lex.config.ts`           | Lexicon codegen config (`bun run lexgen`)                        |

**Records**: Books `buzz.bookhive.book`, buzzes `buzz.bookhive.buzz`, lists `social.popfeed.feed.list`/`.listItem`, follows `app.bsky.graph.follow`.

**XRPC queries**: `searchBooks`, `listGenres`, `getBookIdentifiers`, `getBook`, `getProfile`, `getLanguages`, `getExplore`, `getFeed`, `getAuthorBooks`, `getReadingStats`, `getUserLists`, `getList`.

**XRPC list procedures**: `createList`, `updateList`, `deleteList`, `addToList`, `removeFromList`, `reorderList`.

**XRPC personal library queries**: `getPersonalLibrary`, `getPersonalBook`, `getSyncProgress`, `listSyncDocuments`.

**XRPC personal library procedures**: `uploadPersonalBook`, `deletePersonalBook`, `linkPersonalBook`, `unlinkPersonalBook`, `putSyncProgress`, `createPersonalShelf`, `updatePersonalShelf`, `deletePersonalShelf`, `addToPersonalShelf`, `removeFromPersonalShelf`.

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

The WAF solver's circuit breaker currently also gates the plain-HTTP fetch path. Splitting into separate breakers is the open fix.

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

| Command             | What                                                         |
| ------------------- | ------------------------------------------------------------ |
| `bun run dev`       | Dev server (`bunx --bun vp dev`)                             |
| `bun run build`     | Production build (`lexgen` + `vp build`) → `.output/server/` |
| `bun run start`     | Run built server (`bun run .output/server/index.mjs`)        |
| `bun test`          | Run tests (`bun test src server`)                            |
| `bun run typecheck` | `vp lint src --type-aware --type-check` + `vp fmt --write`   |
| `bun run lint`      | Same as typecheck (oxlint/oxfmt via vp, **not** tsc)         |
| `bun run format`    | `vp fmt`                                                     |
| `bun run lexgen`    | Regenerate AT Protocol XRPC types from lexicons              |
| `bun run seed:db`   | Seed/initialize the DB (`src/initialize.ts`)                 |

**Build pipeline**: Vite+ wrapping Vite 8 + Rolldown + Nitro (preset `bun`). Production builds use custom entry `server/entry.bun.mjs` (adds `reusePort: true`). Docker CMD is `server/cluster.ts` under `tini` init. The `standaloneBundles()` Vite plugin builds 4 worker entry points into `.output/server/workers/`. TypeScript type checking via **tsgo** (TS 6.x); linting via **oxlint**, formatting via **oxfmt**, both through the `vp` CLI. Path alias `@` → `./src`. Runtime requires `bun >= 1.3.14`. Pre-commit hook runs `vp staged` → `vp check --fix`.

Notable deps: hono, kysely, zod 4, iron-session, unstorage + ocache, `@atcute/*`, `@takumi-rs/image-response` + React 19 (OG only), pino, `@hono/prometheus`, `@opentelemetry/*`, basecoat-css, envalid.

## iOS App (`app/`)

Separate Expo/React Native workspace — see `app/ARCHITECTURE.md`. Consumes personal-library and KOSync surfaces (XRPC `*PersonalBook`/`*PersonalShelf` methods, REST `/library/*`, `/settings/sync/*`, `POST /library/upload`).

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
