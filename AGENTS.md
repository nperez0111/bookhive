# BookHive — Agent Reference Index

Goodreads alternative built on Bluesky's AT Protocol. Server-rendered Hono JSX with minimal client-side hydration via `hono/jsx/dom`. Bun runtime, SQLite via Kysely, Tailwind CSS v4. Built with Vite+ (vite-plus, wrapping Vite 8 + Rolldown) + Nitro (preset `bun`), output to `.output/server/`.

This file is a map: what's where, and the load-bearing rules you'd otherwise only learn by
breaking them. Two companion docs go deeper:

- **`ARCHITECTURE.md`** — how `src/` splits into layers (`lib`/`core`/`data`/`services`), the
  shared read layer every transport reads through, and which modules have non-obvious reasons for
  being shaped the way they are.
- **`docs/notes/*.md`** — the **why** behind individual rules: incident details, measured numbers,
  the failure a rule prevents. Linked from the relevant section below and in `ARCHITECTURE.md`.

Read the linked doc before changing anything it covers; the rule alone is easy to "clean up" into
the bug it fixes.

## User preferences (do not remove this)

- Do not commit any changes to git unless otherwise instructed

## Keeping this document current (do not remove this)

This file, `ARCHITECTURE.md`, and `docs/notes/*.md` are living references. **Whenever you change
something they describe, update them in the same change** so they never drift from the codebase.
This includes (non-exhaustive):

- Adding, removing, renaming, or moving routes, pages, components, or modules.
- Changing the DB schema, adding migrations, or altering table columns/keys.
- Adding/removing client hydration islands or worker bundles.
- Changing build/dev/test commands or the build pipeline.
- Adding/removing XRPC methods or lexicons.
- Changing middleware, context shape, or KV mounts.

New load-bearing gotchas (a rule whose reason isn't obvious from the code) belong in the most
relevant `docs/notes/*.md` file, with a one-line pointer added here or in `ARCHITECTURE.md` — not
as a new paragraph in this file. Module-layer and module-boundary changes belong in
`ARCHITECTURE.md`. Treat documentation updates as part of "done." If you notice any of the three is
out of date while working, fix it.

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
  convert-worker      — MOBI/AZW3 to EPUB conversion       (single-shot, src/workers/)
  waf-solver-worker   — AWS WAF challenge solve            (src/scrapers/waf/)
```

**Key patterns** (details in `docs/notes/*.md`):

- Server components (`src/pages/`) render full HTML. Only 6 islands hydrate client-side (`src/client/`); most interactivity is CSS-only (peer/checked selectors) or inline `<Script>` vanilla JS.
- **Production is multi-process**: `server/cluster.ts` spawns `WEB_CONCURRENCY` workers sharing port 8080 via SO_REUSEPORT — defaults to 4, but the deployed container sets **3**. Worker 0 is the **primary** (`isPrimaryWorker`): only it runs migrations, VACUUM, the Jetstream ingester, and the enrichment drain.
- **Enrichment is queued, never inline** (`src/data/enrichQueue.ts`), drained by the primary worker every 5s at concurrency 3 — the only rate limit on Goodreads requests (36/min; don't add a second one). `enrich_queue.attempts` counts _answers from Goodreads_, not failures — the `retry`/`defer`/`dead` verdict (`core/enrichVerdict.ts`) defaults to `defer`. See `docs/notes/enrichment-and-scraping.md`.
- Author lookups use the `hive_book_author` join (mig 020), not `LIKE` — exact identity, not text search.
- `bun:sqlite` is synchronous, so a slow query stalls a whole worker (a third of prod traffic). Expensive aggregates (`/explore*`, `getAvailableLanguages`, `/`'s `landingHighlights` and `communityStats` queries) are SWR-cached rather than plain-TTL, and the `/explore` aggregates rely on an `INDEXED BY` hint because this DB has never been `ANALYZE`d. See `docs/notes/data-and-caching.md`.
- Library re-sync fans out at most `REFETCH_SEARCH_CONCURRENCY` (3) searches; `searchBooks` owns its own concurrency ceiling for the same reason (a prior unbounded fan-out caused an OOM incident). See `docs/notes/enrichment-and-scraping.md`.
- **The activity feed — and RSS, and XRPC `getFeed`/`getProfile` — sorts by `indexedAt`, and whatever it sorts by is what it must display.** `feedActivityIndexedAt` (`src/db.ts`) advances only on feed-visible field changes; migration 027 clamps historical rows and adds the supporting indexes; bursts are collapsed by actor alone, in JS, after the fetch, with the pagination cursor taken from the last _raw_ row consumed. See `docs/notes/activity-feed.md`.
- **Domain facts are asserted once and lifted, never re-derived at a call site**: authors are tab-separated (`core/authors.ts`), there's one status enum (`constants.ts`), three rating scales (`core/rating.ts`), a `HiveId` from the wire must be narrowed not cast (`core/hiveId.ts`), one JSON 401 body (`routes/authResponse.ts`), one handle→DID resolver (`services/actor.ts`), one catalogue search (`data/catalogBooks.ts`). See `docs/notes/domain-rules-and-write-paths.md`.
- **Every PDS-write pair is one core plus two adapters** (a JSON handler and a no-JS form handler) — `updateBookRecord`, `upsertBuzz`, `followUser`/`unfollowUser`. The core owns the rules and returns a discriminated result, never throws; the no-JS adapter is reliably the one that drifts, because nobody exercises it. The same core+adapter shape governs the `book_lock`, the upsert `ON CONFLICT` sets (`userBookUpsertSet`/`buzzUpsertSet`), and every paginated listing (each ends its `ORDER BY` on a unique id). See `docs/notes/domain-rules-and-write-paths.md`.
- **Presentation primitives are asserted once too** — `icons.tsx`, `ProgressMeter.tsx`, `TimeAgo.tsx`, `FilterableDirectory.tsx`, `ShareMenu.tsx`, `ThemeToggle.tsx`, `Pagination.tsx` in `src/pages/components/` are the only correct source for their thing. Islands mount through `client/islands.ts`, which owns the malformed-data guard so one bad island's data can't skip every island registered after it.
- **The app shell (`<main>` in `src/routes/main.tsx`) must never get `overflow-*-auto`**, and basecoat's `.btn-ghost`/`.btn-outline` are patched, not native — see `docs/notes/styling.md`.

## Entry Points

| File                   | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `src/index.ts`         | Bun.serve — HTML bundle route + Hono fetch handler                             |
| `src/server.ts`        | Wires deps via `createAppDeps()` + `createApp()`; graceful shutdown            |
| `src/app.ts`           | Hono app factory — all middleware + route mounting                             |
| `src/entry.html`       | Bun HTML bundle entry (imports CSS + client JS)                                |
| `src/client/index.tsx` | Client bundle entry — mounts the hydrated islands (see Client-Side Components) |

## Routes

`src/app.ts` mounts infra/admin routes, then `/` → `src/routes/main.tsx` (`mainRouter`), which registers standalone pages, the image proxy, feature route modules, and the XRPC router. **Full route-by-route breakdown (every path, method, and per-route gotcha): `docs/notes/routes.md`.**

**Middleware order** in `createApp`: `timing` → `prettyJSON` (dev) → context → wide-event logging → error capture → asset URLs (Vite manifest) → `/images/*` CORP override → `secureHeaders` → `compress` → `jsxRenderer` → OpenTelemetry → default `Cache-Control: private, no-store` → Prometheus `registerMetrics` → `etag` → anon page cache (prod).

- **`etag()` never sees a large or streamed body** — `/library/books/*`, `/opds/books/*` and `/import` are excluded by prefix in `src/app.ts` (`ETAG_EXCLUDED_PREFIXES`). Those routes must answer `If-None-Match`/`Range` themselves; `streamPersonalBook` (`src/data/personalLibrary.ts`) owns that for all three callers. Details: `docs/notes/e-reader-and-sync.md`.
- **Anonymous page cache** (`src/middleware/anon-page-cache.ts`, prod-only) serves signed-out GETs on `/books/*`, `/explore*`, `/authors/*` from KV. Key-encoding and size-limit gotchas: `docs/notes/data-and-caching.md`.
- **Caching policy** is one rule, in `src/core/cacheHeaders.ts`: signed in → `private, no-store` on every path; signed out → cache aggressively so Cloudflare absorbs scraper load. Applied by `cacheControl()` (`src/routes/lib.ts`), the anon page cache, and `server/plugins/cache-headers.ts` (authoritative — runs on the final Response, also sets `Vary: Cookie`). Route-rule and `Vary` gotchas: `docs/notes/data-and-caching.md`.

| Prefix                                                                          | Router                           | Notes                                      |
| ------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------ |
| `/healthcheck`, `/metrics`, `/admin/*`, `/debug/*`, `/import`                   | mounted directly in `src/app.ts` | infra/admin, before `mainRouter`           |
| `/`, `/privacy-policy`, `/legal`, `/pds`, `/images/*`, `/login` etc.            | `src/routes/main.tsx`            | standalone pages + imgproxy                |
| `/home`, `/my-books`, `/feed`, `/search`, `/explore*`, `/authors/*`, `/genres*` | `src/routes/pages.tsx`           |                                            |
| `/profile*`, `/refresh-books`                                                   | `src/routes/profile.tsx`         |                                            |
| `/books/*`                                                                      | `src/routes/books.tsx`           | `UserBookView` is the one book-state shape |
| `/comments`                                                                     | `src/routes/comments.tsx`        |                                            |
| `/shelves/*`                                                                    | `src/routes/shelves.tsx`         | popfeed lexicons                           |
| `/settings/*`                                                                   | `src/routes/settings.tsx`        |                                            |
| `/library/*`                                                                    | `src/routes/library.tsx`         | personal library, auth-required            |
| `/api/*`                                                                        | `src/routes/api.tsx`             | JSON writes + follow endpoints             |
| `/rss/*`                                                                        | `src/routes/rss.ts`              | ordered/dated by `indexedAt`               |
| `/opds/*`                                                                       | `src/routes/opds.ts`             | e-reader catalog, dual-format              |
| `/og/*`                                                                         | `src/routes/og.tsx`              | OG images, no server cache                 |
| `/kosync/*`                                                                     | `src/routes/sync/kosync.ts`      | KOReader sync                              |

Shared helpers: `src/routes/lib.ts` (`cacheControl`, `searchBooks`, `refetchBooks`/`refetchBuzzes`/`refetchLists`, `syncFollowsIfNeeded`), `src/routes/syncCredentials.tsx` (KOSync/OPDS password, mounted at both `/settings/sync` and `/library/sync`), `src/routes/errorPage.tsx`'s `renderError(c, {status, ...})` — always use it rather than a bare `<ErrorPage>` render, since its `statusCode` prop is display-only and won't set the actual HTTP status.

## Server-Side Pages (`src/pages/`)

Each file exports a Hono JSX component rendered server-side.

| File                  | Renders                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `layout.tsx`          | HTML shell — meta tags, assets, `<head>`/`<body>`                         |
| `navbar.tsx`          | Top nav bar with account disclosure on desktop/mobile, search mount point |
| `simple-navbar.tsx`   | Simplified nav bar variant                                                |
| `sidebar.tsx`         | Home, My Books, Shelves, Discover, Activity Feed, Ebooks & Devices        |
| `home.tsx`            | Authenticated home page                                                   |
| `myBooks.tsx`         | Signed-in tracked books, import and management links                      |
| `marketing.tsx`       | Marketing landing (signed-out only; `/` redirects)                        |
| `searchResults.tsx`   | Search results                                                            |
| `bookInfo.tsx`        | Book detail                                                               |
| `profile.tsx`         | User profile + shelves                                                    |
| `shelves.tsx`         | Book shelves view                                                         |
| `comments.tsx`        | Comments/reviews                                                          |
| `feed.tsx`            | Activity feed                                                             |
| `readingStats.tsx`    | Reading stats by year                                                     |
| `settings.tsx`        | Account settings                                                          |
| `explore.tsx`         | Explore hub                                                               |
| `genres.tsx`          | Genre directory                                                           |
| `genreBooks.tsx`      | Books by genre (paginated, sortable)                                      |
| `genreEmoji.ts`       | Genre → emoji mapping                                                     |
| `authorBooks.tsx`     | Books by author (paginated)                                               |
| `authorDirectory.tsx` | Author directory                                                          |
| `import.tsx`          | CSV import page                                                           |
| `library.tsx`         | Personal library                                                          |
| `login.tsx`           | Login form                                                                |
| `signup.tsx`          | Sign up form                                                              |
| `app.tsx`             | iOS app landing                                                           |
| `privacy-policy.tsx`  | Privacy policy                                                            |
| `terms.tsx`           | Terms of service (`/legal`)                                               |
| `pds.tsx`             | PDS info page                                                             |
| `error.tsx`           | Error page                                                                |

Page utilities: `src/pages/utils/script.ts` (inline JS helper), `src/pages/utils/viewTransitions.ts` (snapshot name deduplication; see `docs/notes/styling.md`). URL building lives in `src/lib/buildUrl.ts`.

**`Layout` always needs `url={c.req.url}`** passed explicitly. It falls back to `useRequestContext()`, which throws for the ~14 routes rendered via `c.html(<Layout …>)` instead of `c.render(…)`, silently defaulting `url` to `https://bookhive.buzz` — which broke `<link rel="canonical">`/`og:url` on `/privacy-policy` and `/legal` in production.

### Raster images in `public/`

Page images are `<picture>` with a WebP `<source>` and the original as the `<img>` fallback. Regenerate with `cwebp -preset picture -q 78..82 -m 6 [-resize <w> 0] in -o out.webp` (always `-preset picture` — the default preset gave 419 KB where `picture` gave 164 KB on the same input/quality; skip `-z 9` lossless on JPEG sources, it comes out larger). Size the WebP to ~2x the CSS slot.

| Asset                                                       | Serves                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `hive-{768,1280}.webp` + `hive.jpg`                         | Marketing hero. The LCP element — `fetchpriority="high"`, intrinsic `width`/`height`, never lazy |
| `screenshots/{home-screen,book-info,comment}.webp` + `.png` | `/app` phone mockups                                                                             |
| `full_logo-384.webp` + `full_logo.jpg`                      | Login/signup logo (rendered at 192px)                                                            |

**Do not convert these to WebP**: `full_logo.jpg` is also the default `og:image`/OAuth `logo_uri` (third parties may not decode WebP); `og-fallback.png` is an OG/Twitter card image (unreliable crawler WebP support); `android-chrome-{192,512}.png` is referenced by `site.webmanifest` with an explicit PNG type; `apple-touch-icon.png`/`favicon*` are fixed-format platform requirements. The other 13 `public/screenshots/*.png` look like App Store listing assets and are referenced nowhere — kept as-is.

### Shared Page Components (`src/pages/components/`)

| File                      | What                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `book.tsx`                | Book card component                                                            |
| `TrackedBooks.tsx`        | Shared LibraryTable mount, props and no-JS cover grid for My Books/own profile |
| `BookCard.tsx`            | Composable book card (`dense` takes `showAuthor` for search/genre grids)       |
| `icons.tsx`               | The one icon set — `Icon`/`SolidIcon` wrappers plus the named glyphs           |
| `ThemeToggle.tsx`         | The one dark-mode toggle + its script (owns the `theme-color` value)           |
| `Pagination.tsx`          | The one offset pager (`/search`, genre, author). Uses `pageWindow`             |
| `ProgressMeter.tsx`       | The one filled-track meter (reading progress, storage, genre chart)            |
| `TimeAgo.tsx`             | The one relative timestamp — strict wording, `<time datetime title>`           |
| `FilterableDirectory.tsx` | `/explore/genres` + `/explore/authors`: filter box, rows, filter script        |
| `ShareMenu.tsx`           | The one share dropdown (Bluesky / copy link / copy RSS)                        |
| `activityTimeline.tsx`    | `/feed`'s chronological `<ol>` — single rows, burst rows, date separators      |
| `BookReview.tsx`          | Book review form/display                                                       |
| `ProfileHeader.tsx`       | Profile header with avatar/stats                                               |
| `LanguageSelect.tsx`      | Language picker                                                                |
| `modal.tsx`               | Modal dialog (CSS-based)                                                       |
| `fallbackCover.tsx`       | Placeholder book cover                                                         |
| `AtTags.tsx`              | AT Tags `<meta name="at:...">` builder                                         |
| `cards/`                  | `Card`, `CardActions`, `StarDisplay`, `UserBlock`                              |

`AtTags.tsx` is built with hono's `html` template (not JSX `<meta>`) because hono/jsx dedupes by `name`. Routes pass tags via `c.render(..., { atTags })`. Why each of these is the _only_ correct source for its thing: `docs/notes/domain-rules-and-write-paths.md`.

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

**`BookIslands`** is the signed-in half of `/books/:id` (status/owned, timestamp line, "Your Activity" card). One `createUserBookStore` per page holds `{ view, confirmed, pending, error }`; the three components subscribe with `useSyncExternalStore` since they can't share a root. Props are JSON in `#mount-book-actions[data-props]`.

- Changes are optimistic and replaced by the server's `UserBookView`; `applyOptimistic` and the server share `nextReadingState`, including completion from explicit progress saves.
- Writes are serialised — a response never overwrites `view` while later ones are queued, and a delete blocks writes for its whole duration.
- The server-rendered forms inside the mounts are the pre-hydration paint and all a no-JS visitor gets — keep their inline `<Script>` handlers.

`StarRating` isn't mounted on its own; the activity panel renders it, following its `initialRating` prop so rollback/reconcile shows in the stars.

`LibraryManager` sub-components live in `src/client/components/library/`: `AnchoredMenu.tsx`, `ShelfTabs.tsx`, `PersonalBookCard.tsx`, `SyncDocumentSections.tsx`, `types.ts`. `AnchoredMenu`/`MenuItem`/`MenuConfirm` are the house dropdown (no state, `peer` checkbox + `<form>` reset) used by all library menus — don't switch to Popover API or CSS anchor positioning (both tried and reverted).

The My Books / own-profile `LibraryTable` serializes writes per book and reconciles canonical responses via `client/components/libraryTableStore.ts`. Owned toggles use that queue, and deletion keeps the row and confirmation dialog visible until the server succeeds. Empty own-profile shelves link to `/search` and open the hydrated search palette through `data-open-search`; see `docs/notes/domain-rules-and-write-paths.md`.

Other client components: `bookActions.tsx`, `ProgressBar.tsx`. Client hooks/utils: `useSearchBooks.ts`, `useDebounce.ts`. Icons always come from `src/pages/components/icons.tsx` — there is no client-only icon module.

## Data Layer

### Database (`src/db.ts`)

SQLite via Kysely. Schema + all migrations (001–028) in one file. `createDb` sets WAL/perf PRAGMAs. `mmap_size` defaults to 0 (see `DB_MMAP_SIZE` in `src/env.ts`). Kysely talks to `bun:sqlite` through `src/bun-sqlite-kysely.ts`, which rewrites `begin` to `BEGIN IMMEDIATE` (deferred transactions fail with `SQLITE_BUSY_SNAPSHOT` across cluster processes) and decides `statement.reader` by asking SQLite (`stmt.columnNames`) rather than pattern-matching the SQL — a regex anchored on `SELECT` misclassifies `WITH cte AS (…) SELECT …` as a write.

| Table                 | Purpose                   | Key columns                                                                                                                                                                                              |
| --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_book`           | User's book records       | uri (PK), userDid, hiveId, title, authors, status, **stars** (not `rating`), review, startedAt, finishedAt, **owned** (bool), bookProgress, previousReads (JSON), **record** (JSON, mig 025)             |
| `hive_book`           | Canonical book data       | id (HiveId, PK), title, authors (**tab-separated**), cover, thumbnail, description, rating, ratingsCount, series, meta, enrichedAt, enrichAttempts, enrichFailedAt, identifiers, hiveBookAtUri, language |
| `hive_book_genre`     | Genre-to-book mapping     | hiveId, genre (UNIQUE pair). **Genres live ONLY here**                                                                                                                                                   |
| `hive_book_fts`       | FTS5 search index         | External-content FTS5 over `hive_book(title, rawTitle, authors)`, trigger-maintained. Never written directly. Rebuilt after VACUUM                                                                       |
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
| `progress_history`    | Reading progress log      | id (PK, autoincrement), userDid, hiveId, currentPage, totalPages, percent, createdAt. Deduped on insert against the latest entry for the same user+book                                                  |

`book_list*` are keyed by AT URI, not numeric ids. `NO_HIVE_MATCH` sentinel (`bk_none`) on `sync_document.hiveId` means the user dismissed the match — read paths must surface `{ hiveId: null, dismissed: true }`. `enqueueEnrichmentBatch` filters books with recent `enrichAttempts`/`enrichFailedAt` internally (7d cooldown).

VACUUM and FTS-rebuild scheduling (`src/context.ts`) is gated on freelist ratio, not run unconditionally — full reasoning and measured costs: `docs/notes/data-and-caching.md`.

### KV Cache (`src/sqlite-kv.ts`)

SQLite-backed unstorage. Mounts: `search:` (in-memory LRU), `profile:`, `identity:`, `follows_sync:`, `auth_session:`, `auth_state:`, `book_lock:`, `sync_pending:`, `sync_token:`, `page:` (anon page cache). VACUUMed on startup by primary worker; incremental vacuum on 15-min sweep.

### Module layers (`src/lib`, `src/core`, `src/data`, `src/services`)

`src/` is split into four layers with one allowed import direction (`services → data → core → lib`), plus a shared read layer in `src/data/` that HTML/XRPC/OPDS/RSS/KOSync all read through instead of each re-deriving the same query. **Full layer rules, the bucket-selection checklist, and the list of modules whose reasoning isn't obvious from their name: `ARCHITECTURE.md`.**

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

`getFeed` paginates by `cursor`, not `page` (`page` stays accepted for old iOS builds — see `docs/notes/activity-feed.md`). `getProfile` deliberately returns `indexedAt` in the `createdAt` field on `activity`/`friendActivity` — don't "fix" this; the shape follows the lexicon, and the lexicon hasn't added `indexedAt` yet. `books` keeps its true `createdAt` for the app's labelled "Date Added" sort. Full reasoning: `docs/notes/activity-feed.md`.

**XRPC list procedures**: `createList`, `updateList`, `deleteList`, `addToList`, `removeFromList`, `reorderList`.

**XRPC personal library queries**: `getPersonalLibrary` (params `limit`/`cursor`/`shelfId`/`q`/`sort`; output carries `storage`), `getPersonalBook`, `getPersonalBookFile`, `getPersonalBookCover`, `listPersonalShelves`, `getSyncProgress`, `listSyncDocuments`.

**XRPC personal library procedures**: `uploadPersonalBook`, `deletePersonalBook`, `linkPersonalBook`, `unlinkPersonalBook`, `putSyncProgress`, `createPersonalShelf`, `updatePersonalShelf`, `deletePersonalShelf`, `addToPersonalShelf`, `removeFromPersonalShelf`.

Every `getPersonalLibrary` sort ends on `personal_book.id` — see `docs/notes/domain-rules-and-write-paths.md`.

**The personal library is fully reachable over XRPC, not just `/opds`** — both transports call `listPersonalBooks`/`personalBookView` from `data/personalBooks.ts`. Parity map:

| OPDS route                              | XRPC method                                        |
| --------------------------------------- | -------------------------------------------------- |
| `GET /opds` (root nav + counts)         | `listPersonalShelves` — the root call, one request |
| `GET /opds/all`                         | `getPersonalLibrary`                               |
| `GET /opds/shelves/:id`                 | `getPersonalLibrary?shelfId=`                      |
| `GET /opds/search/results`              | `getPersonalLibrary?q=&sort=title` (same SQL)      |
| `GET /opds/books/:hash/download/{name}` | `getPersonalBookFile`                              |
| `GET /opds/books/:hash/cover`           | `getPersonalBookCover`                             |
| `GET /opds/search` (OpenSearch doc)     | n/a — an XRPC client reads the lexicon instead     |

Two methods declare non-JSON bodies: `uploadPersonalBook` (input MIME list includes `application/octet-stream` since the declared type is client-asserted and worthless as a control — `detectFormat` checking magic bytes against the required `filename` query param is the real gate) and `getPersonalBookFile`/`getPersonalBookCover` (bare `Response`, own every header, excluded from `etag`/`compress` by exact NSID path).

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

`google.ts`/`isbndb.ts` are tracked but not imported anywhere — reference material for a future Goodreads-WAF fallback, not live code. `images.isbndb.com` stays in the `imageProxy` allowlist because historical `hive_book` rows still point there.

**`waf/`'s page fetch has no gate of any kind in front of it, and there's no circuit breaker — adding one back is a regression.** A prior breaker fed by solve outcomes sat open and refused the path that still worked once AWS WAF stopped honouring our tokens (8,606 refusals across 6,840 books in one 6h window while 95.6% of allowed-through requests succeeded). See `docs/notes/enrichment-and-scraping.md` and `src/scrapers/waf/README.md` for the full account.

## Auth (`src/auth/`)

| File               | Purpose                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `router.tsx`       | Login/logout/OAuth callback routes                                           |
| `client.ts`        | OAuth client creation                                                        |
| `storage.ts`       | Session/state stores (unstorage-backed)                                      |
| `handle.ts`        | Handle validation                                                            |
| `session.ts`       | `getSessionConfig` (the `sid` cookie) + the in-process `SessionClient` cache |
| `refresh-lock.ts`  | Cross-process token-refresh lock (SQLite `auth_refresh_lock`)                |
| `restore-guard.ts` | Per-PDS timeout (5s) + circuit breaker around `restore()`                    |

**Key constraint**: `guardedRestore` wraps every OAuth restore in a 5s timeout + circuit breaker keyed by the authorization-server host. `getSessionAgent` only destroys sessions on terminal credential errors, never on timeouts.

### XRPC auth (`src/xrpc/auth.ts`)

`/xrpc/*` accepts the `sid` cookie **or** an atproto inter-service auth JWT (`Authorization: Bearer <token>`, verified with `ServiceJwtVerifier`), which is what makes the personal library usable from a script or e-reader rather than only a browser session. Bearer wins when both are present. A method declares `auth: "identity" | "pdsWrite"`; `identity` methods only need the DID, `pdsWrite` methods (the six book-list procedures) need a live OAuth session — service auth can never satisfy `pdsWrite`, since it proves key control, not that we hold a grant.

Load-bearing specifics — exact-match audience checking, the non-default `SERVICE_AUTH_MAX_AGE_SECONDS`, no prior-relationship gate, no replay protection, and the third-party token-minting example — are in `docs/notes/e-reader-and-sync.md`.

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

**App-defined classes in `src/index.css`** (basecoat does not provide these):

| Class                                            | What                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `.card-title`                                    | Section heading inside (or outside) a `.card`. Deliberately unscoped                                                         |
| `.empty` / `.empty-title` / `.empty-description` | The one empty-state treatment — prefer it over another hand-rolled `py-12 text-center` block                                 |
| `.focus-ring`                                    | The one focus recipe (`focus-visible` outline on `--ring`). Use instead of `focus:outline-none` plus a hardcoded ring colour |
| `.book-cover-frame`                              | Tinted placeholder on a cover box so lazy-loaded grids don't flash empty                                                     |
| `.book-cover` + `.is-loaded`                     | Cover fade-in, decode-triggered — `docs/notes/styling.md`                                                                    |
| `.sidebar`, `.tab-label`                         | Pre-existing component classes                                                                                               |

Form controls get a low-alpha white overlay in dark mode rather than `var(--input)` (a saturated amber here). Tap targets are `min-h-10`/`min-w-10` (not the `min-h-[40px]` bracket form).

**Two gotchas worth reading before you touch either**: `<main>`'s overflow/padding rules, and basecoat's `.btn-ghost`/`.btn-outline` being patched rather than native — both in `docs/notes/styling.md`.

## Build & Dev

In this Paseo workspace, start the managed `dev` script (`paseo script start dev`). `paseo.json` pins it to port 5199, binds Vite to `0.0.0.0`, and sets `PUBLIC_URL=https://5199.dev.nickthesick.com` for browser access and OAuth callbacks.

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

**Build pipeline**: Vite+ wrapping Vite 8 + Rolldown + Nitro (preset `bun`). Production builds use custom entry `server/entry.bun.mjs` (adds `reusePort: true`). Docker CMD is `server/cluster.ts` under `tini` init. The `standaloneBundles()` Vite plugin builds 7 worker entry points into `.output/server/workers/`. Type checking via **tsgo** (TS 6.x); linting via **oxlint**, formatting via **oxfmt**, both through the `vp` CLI. **Do not use `@/…` in `src/` or `server/`** — `vite.config.ts` maps it but the root `tsconfig.json` doesn't, so tsgo can't resolve it even though bundling works; `app/`'s own `@/*` → `app/*` alias is unrelated. Runtime requires `bun >= 1.4.0`. Pre-commit hook runs `vp staged` → `vp check --fix`.

The dev server binds loopback by default. `PORT` (default 8080), `DEV_HOST` (default `127.0.0.1`), `DEV_HMR_CLIENT_PORT`, and `DEV_HMR_PROTOCOL` (default `wss` when a client port is set) let a TLS-terminating proxy publish it without editing `vite.config.ts`. An explicit `PORT` enables `strictPort`; `allowedHosts` is derived from `PUBLIC_URL` rather than disabled. `PUBLIC_URL` also selects the public OAuth client metadata URL, so it must match the browser origin and be reachable by the user's PDS. The pinned Paseo hostname avoids invalidating the host-only session cookie on every restart.

Notable deps: hono, kysely, zod 4, iron-session, unstorage + ocache, `@atcute/*`, `@takumi-rs/image-response` + React 19 (OG only), pino, `@hono/prometheus`, `@opentelemetry/*`, basecoat-css, envalid.

**`bunfig.toml` preloads `src/test/env-setup.ts`, and that is load-bearing.** envalid freezes `env` at import, so `DB_PATH`/`LIBRARY_DIR` can only be set before the import graph loads — without it, tests exercising an upload write ebooks into the working tree. Related: **`mock.module("../env", …)` is process-wide and permanent** — a bare mock object replaces `env` for every module loaded afterwards in the same run, so unnamed fields read back `undefined`; spread the real `env` when mocking it.

## iOS App (`app/`)

Separate Expo/React Native workspace — see `app/ARCHITECTURE.md`. Consumes personal-library and KOSync surfaces (XRPC `*PersonalBook`/`*PersonalShelf` methods, REST `/library/*`, `/settings/sync/*`, `POST /library/upload`).

The app renders `payload.error` verbatim for any non-2xx upload response, which is why the quota rejection (413) carries human prose rather than a bare code. It reads `storage` off `getPersonalLibrary` for its own quota meter, so **anything that changes the quota's wire shape needs an app release**. `app/utils/personalLibrary.ts`'s `formatBytes` is a deliberate byte-for-byte copy of the server's.

## Third-party clients (service auth)

```http
# 1. Mint a token on YOUR OWN PDS, bound to one method and one audience.
GET  https://<your-pds>/xrpc/com.atproto.server.getServiceAuth
       ?aud=did:plc:enu2j5xjlqsjaylv3du4myh4
       &lxm=buzz.bookhive.uploadPersonalBook
       &exp=<now + 60>
  -> { "token": "..." }

# 2. Call BookHive directly. `filename` is a required query param; body is raw bytes.
POST https://bookhive.buzz/xrpc/buzz.bookhive.uploadPersonalBook?filename=Dune.epub
  Authorization: Bearer <token>
  Content-Type: application/epub+zip
  <raw bytes>
```

Full notes on scopes, re-consent, and `atproto-proxy`'s current limits: `docs/notes/e-reader-and-sync.md`.

## Workers, Logging & Observability

| Path                                 | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `src/workers/ingester-worker.ts`     | Jetstream ingest (off-thread)                              |
| `src/workers/og-render/`             | OG image render (React + takumi)                           |
| `src/workers/open-observe-worker.ts` | pino → OpenObserve log shipping                            |
| `src/workers/import/`                | CSV import processing                                      |
| `src/workers/singleShot.ts`          | The one spawn-ask-terminate Worker driver (parse, convert) |
| `src/logger/index.ts`                | pino logger; redacts cookies                               |
| `src/metrics.ts`                     | Prometheus metrics                                         |
| `src/pds/client.ts`                  | Self-hosted PDS support                                    |
| `server/cluster.ts`                  | Multi-process supervisor (Docker CMD)                      |
| `server/worker-exit.ts`              | Exit classification + procfs memory read                   |
| `server/entry.bun.mjs`               | Custom Nitro entry (SO_REUSEPORT)                          |
| `server/plugins/`                    | `otel-sdk.ts`, `request-tracing.ts`, `cache-headers.ts`    |

Per-process metrics carry a `worker` label from `WORKER_INDEX`. Memory debugging: use `Anonymous` (not `Rss`) — RSS includes reclaimable SQLite mmap. `/debug/memory` separates them.

## Context & Session (`src/context.ts`)

`AppContext` — singleton deps: `db`, `kv`, `ingester`, `oauthClient`, `resolver`/`baseIdResolver`, `getSessionDid()` (fast cookie-only DID), `getSessionAgent()` (OAuth session), `getProfile()`, `serviceAccountAgent`, `addWideEventContext`.

Hono context vars (`c.get`): `ctx`, `assetUrls`, `requestId`, `wideEventBag`, `appLogger`, `requestError`.

`createAppDeps()` builds deps and (primary only) spawns the ingester + enrichment drain. Sessions use `iron-session` (180-day cookie) with an in-memory `SessionClient` cache. `getProfile` is read-through cached (24h revalidate / 30d TTL).
