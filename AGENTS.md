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

**Key pattern**: Server components (`src/pages/`) render full HTML. Only 5 islands are hydrated client-side (`src/client/`). Most interactivity is CSS-only (peer/checked selectors for tabs, dropdowns, modals) or inline `<Script>` vanilla JS.

**Asset URLs**: In production, resolved from the Vite build manifest via `src/utils/manifest.ts` (`loadViteManifest`/`getAssetUrlsFromManifest`), exposed on the Hono context as `assetUrls`. The `/_bundle` HTML import route still exists for Bun dev.

**Ingester runs as a worker thread**, not in-process. `createAppDeps` spawns `new Worker(ingester-worker)`; `ingester.destroy()` terminates it. Worker posts `wideEvent` messages back to the pino logger.

## Entry Points

| File                   | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `src/index.ts`         | Bun.serve — HTML bundle route + Hono fetch handler                  |
| `src/server.ts`        | Wires deps via `createAppDeps()` + `createApp()`; graceful shutdown |
| `src/app.ts`           | Hono app factory — all middleware + route mounting                  |
| `src/entry.html`       | Bun HTML bundle entry (imports CSS + client JS)                     |
| `src/client/index.tsx` | Client bundle entry — mounts 5 hydrated components                  |

## Routes

`src/app.ts` (`createApp`) mounts top-level infra/admin routes, then `/` →
`src/routes/main.tsx` (`mainRouter`). `mainRouter` registers a few standalone
pages, the image proxy, then mounts the feature route modules and the XRPC
router. Middleware order in `createApp`: `timing` → `prettyJSON` (dev) →
context → wide-event logging → error capture → asset URLs (Vite manifest) →
`secureHeaders` → `compress` → `jsxRenderer` → OpenTelemetry.

### Mounted in `src/app.ts` (infra/admin, before `mainRouter`)

- `/healthcheck` → JSON status + git sha + startedAt
- `/metrics` → Prometheus (`@hono/prometheus` defaults + custom registry)
- `/sitemap.xml` → static sitemap (`/`, `/app`, `/privacy-policy`)
- `/admin/*` → `src/routes/admin.ts` (gated by `EXPORT_SHARED_SECRET`)
- `/debug/*` → `src/routes/debug.ts` (gated by `EXPORT_SHARED_SECRET`)
- `/import` (POST `/goodreads`, `/storygraph`) → `src/routes/import.ts` — CSV import handler
- `app.notFound` → JSON 404

### Standalone pages in `src/routes/main.tsx`

- `/privacy-policy` → `src/pages/privacy-policy.tsx`
- `/legal` → `src/pages/terms.tsx` — terms of service
- `/pds` → `src/pages/pds.tsx` — PDS info (redirects to `/` if PDS disabled)
- `/` → `src/pages/marketing.tsx` — marketing landing; redirects to `/app` for the iOS host/`?app`, to `/home` when logged in; trending books + recent activity, cached 1h via `readThroughCache`
- `/images/*` → signing reverse-proxy to **imgproxy** (remote sources only; allowed hosts `i.gr-assets.com`, `cdn.bsky.app` via `src/utils/imageProxy.ts`; URL modifiers like `w_440` / `s_300x500,fit_cover` translated to imgproxy options and signed server-side with `IMGPROXY_KEY`/`IMGPROXY_SALT`; SVG fallback on forbidden/failed source; meant to be edge-cached by Cloudflare). If `IMGPROXY_URL` is unset, redirects to the source URL. **Replaced the Bun.Image proxy.** Three route shapes share one proxy helper (`proxyImageResponse` in `src/utils/imageProxy.ts`):
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

- GET `/:hiveId` → `src/pages/bookInfo.tsx` — book detail; re-enriches if stale (>30d) or `force-refresh`
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

### `src/routes/api.tsx` (mounted at `/api`) — JSON/form mutations

- POST `/update-book`, `/update-comment`
- POST `/follow`, `/follow-form`, `/unfollow`, `/unfollow-form` (writes `app.bsky.graph.follow` + `user_follows.isActive`)

### `src/routes/rss.ts` (mounted at `/rss`)

- GET `/user/:handle`, `/book/:hiveId`, `/friends/:handle` → RSS 2.0 feeds

### `src/routes/og.tsx` (mounted at `/og`) — OG images (offloaded to og-render worker)

- `/marketing`, `/book/:hiveId`, `/profile/:handle`, `/profile/:handle/stats/:year`, `/author/:author`, `/genre/:genre`, `/app` → `image/webp`, cached per-TTL

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
| `login.tsx`           | Login form                                                         |
| `signup.tsx`          | Sign up form                                                       |
| `app.tsx`             | iOS app landing page                                               |
| `privacy-policy.tsx`  | Privacy policy                                                     |
| `terms.tsx`           | Terms of service (`/legal`)                                        |
| `pds.tsx`             | PDS info page (`/pds`)                                             |
| `error.tsx`           | Error page                                                         |

### Shared Page Components (`src/pages/components/`)

| File                       | What                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `book.tsx`                 | Book card component                                                                           |
| `BookCard.tsx`             | Composable book card                                                                          |
| `buzz.tsx`                 | Buzz/comment display                                                                          |
| `BookReview.tsx`           | Book review form/display                                                                      |
| `EditableLibraryTable.tsx` | Library table with inline editing                                                             |
| `ProfileHeader.tsx`        | Profile header with avatar/stats                                                              |
| `LanguageSelect.tsx`       | Language picker (search/explore filters)                                                      |
| `modal.tsx`                | Modal dialog (CSS-based)                                                                      |
| `fallbackCover.tsx`        | Placeholder book cover                                                                        |
| `cards/`                   | Sub-components: `Card.tsx`, `CardActions.tsx`, `StarDisplay.tsx`, `UserBlock.tsx`, `index.ts` |

Inline JS helper: `src/pages/utils/script.ts`

## Client-Side Components (`src/client/`)

Only 5 hydration islands, mounted in `src/client/index.tsx`:

| Component        | Mount Point                      | File                                              |
| ---------------- | -------------------------------- | ------------------------------------------------- |
| `SearchTrigger`  | `#mount-search-box` (navbar)     | `src/client/components/SearchBox.tsx`             |
| `SearchPalette`  | `#mount-search-palette`          | `src/client/components/SearchPalette.tsx`         |
| `StarRating`     | `#star-rating` (book page)       | `src/client/components/StarRating.tsx`            |
| `ImportTableApp` | `#import-table` (import page)    | `src/client/components/import/ImportTableApp.tsx` |
| `LibraryTable`   | `#mount-library-table` (profile) | `src/client/components/LibraryTable.tsx`          |

Non-mounted client components: `bookActions.tsx`, `ProgressBar.tsx` (imported by others).

Client hooks/utils:

- `src/client/components/utils/useSearchBooks.ts` — search via XRPC
- `src/client/components/utils/useDebounce.ts` — debounce hook
- `src/client/components/utils/icons.tsx` — SVG icons
- `src/client/utils/debounce.ts`, `throttle.ts` — utility functions

## Data Layer

### Database (`src/db.ts`)

SQLite via Kysely. Schema + all migrations (001–013) in one file. `createDb`
sets WAL/perf PRAGMAs; migrations run with fsync disabled and a background
`VACUUM` on startup. Exports `BookFields` (select list) and
`syncHiveBookGenres()`.

| Table             | Purpose                   | Key columns                                                                                                                                                              |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_book`       | User's book records       | uri (PK), cid, userDid, hiveId, title, authors, status, **stars**, review, startedAt, finishedAt, **owned**, bookProgress                                                |
| `hive_book`       | Canonical book data       | id (HiveId, PK), title, authors (**tab-separated**), cover, thumbnail, description, rating, ratingsCount, series, meta, enrichedAt, identifiers, hiveBookAtUri, language |
| `hive_book_genre` | Genre-to-book mapping     | hiveId, genre (UNIQUE pair). **Genres live ONLY here** — the old `hive_book.genres` column was dropped (mig 011)                                                         |
| `book_id_map`     | ISBN/Goodreads cross-refs | hiveId (PK), isbn, isbn13, goodreadsId, updatedAt                                                                                                                        |
| `buzz`            | Comments on books         | uri (PK), cid, userDid, hiveId, **comment**, bookUri, parentUri, createdAt                                                                                               |
| `user_follows`    | Cached follow graph       | userDid, followsDid, followedAt, syncedAt, **isActive**                                                                                                                  |
| `book_list`       | User-created book lists   | **uri (PK, AT URI)**, cid, userDid, name, description, ordered, tags, createdAt                                                                                          |
| `book_list_item`  | Items in a book list      | **uri (PK, AT URI)**, cid, userDid, **listUri**, hiveId, position, embeddedTitle/Author/CoverUrl, identifiers                                                            |

Notes: `user_book` has no `rating` column (it's `stars`); `owned` is a boolean
column, **not** a status (legacy `…#owned` status migrated to `owned=1`).
`book_list*` are keyed by AT URI (`uri`/`listUri`), not numeric ids.

### KV Cache (`src/sqlite-kv.ts`)

SQLite-backed unstorage for: profiles, identity resolution, search results, auth sessions/state, follows sync timestamps.

### Key Data Utilities

| File                                                                                                                           | Purpose                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `src/utils/getBook.ts`                                                                                                         | Book record CRUD against user's PDS |
| `src/utils/getProfile.ts`                                                                                                      | Profile fetching from Bluesky       |
| `src/utils/getFollows.ts`                                                                                                      | Follow graph sync                   |
| `src/utils/enrichBookData.ts`                                                                                                  | Background Goodreads enrichment     |
| `src/utils/bookIdentifiers.ts`                                                                                                 | ISBN/ID normalization + persistence |
| `src/utils/bookProgress.ts`                                                                                                    | BookProgress serialization          |
| `src/utils/readThroughCache.ts`                                                                                                | KV read-through with TTL            |
| `src/utils/csv.ts`                                                                                                             | Goodreads/StoryGraph CSV parsers    |
| `src/utils/lists.ts`                                                                                                           | Book list (shelf) CRUD against PDS  |
| `src/utils/readingStats.ts`                                                                                                    | Reading stats aggregation by year   |
| `src/utils/catalogBookService.ts`                                                                                              | Catalog backfill (admin)            |
| `src/utils/deleteAccount.ts`                                                                                                   | Account data deletion               |
| `src/utils/dbExport.ts`                                                                                                        | Sanitized DB/KV export (admin)      |
| `src/utils/manifest.ts`                                                                                                        | Vite manifest → asset URLs          |
| `src/utils/getLanguages.ts`                                                                                                    | Language list/normalization         |
| `src/utils/importBook.ts`                                                                                                      | Import a single book record         |
| `src/utils/authorMatching.ts`                                                                                                  | Author name matching                |
| `src/utils/generateInitialsAvatar.ts`                                                                                          | SVG initials avatar                 |
| `src/utils/htmlToText.ts`, `batchTransform.ts`, `lazy.ts`, `hiveBookGenres.ts`, `ensureBookCataloged.ts`, `uploadImageBlob.ts` | misc helpers                        |

## Types (`src/types.ts`)

All shared TypeScript types: `HiveId`, `UserBook`, `HiveBook`, `Buzz`, `BookProgress`, `SearchResult`, etc.

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

## Scrapers (`src/scrapers/`)

| File               | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `goodreads.ts`     | Search API scraper                            |
| `moreInfo.ts`      | Goodreads page scraper (genres, series, meta) |
| `google.ts`        | Google Books scraper                          |
| `isbndb.ts`        | ISBNdb scraper                                |
| `getHiveId.ts`     | HiveId generation (hash of title+author)      |
| `languageNames.ts` | Language name normalization                   |
| `index.ts`         | `findBookDetails` entry point                 |

## Auth (`src/auth/`)

| File         | Purpose                                 |
| ------------ | --------------------------------------- |
| `router.tsx` | Login/logout/OAuth callback routes      |
| `client.ts`  | OAuth client creation                   |
| `storage.ts` | Session/state stores (unstorage-backed) |
| `handle.ts`  | Handle validation                       |

## Middleware (`src/middleware/`)

Applied globally in `src/app.ts`: timing, context, wide-event logging, error capture, asset URLs, secure headers, compression, JSX renderer, OpenTelemetry, Prometheus.

## Styling

- **Tailwind CSS v4** with `@tailwindcss/forms` and `tailwindcss-animated` plugins
- Config: `tailwind.config.js` — custom `yello` color palette
- PostCSS: `postcss.config.js`
- Entry: `src/index.css`
- CSS-only interactivity patterns: peer/checked selectors for tabs, dropdowns, modals

## Build & Dev

| Command             | What                                                           |
| ------------------- | -------------------------------------------------------------- |
| `bun run dev`       | Dev server (`bunx --bun vite`)                                 |
| `bun run build`     | Production build (`lexgen` + `vite build`) → `.output/server/` |
| `bun run start`     | Run built server (`bun run .output/server/index.mjs`)          |
| `bun test`          | Run tests (`bun test src`)                                     |
| `bun run typecheck` | `oxlint --type-aware --type-check` + `oxfmt --write`           |
| `bun run lint`      | Same as typecheck (oxlint/oxfmt, **not** tsc)                  |
| `bun run lexgen`    | Regenerate AT Protocol XRPC types from lexicons (`lex-cli`)    |
| `bun run seed:db`   | Seed/initialize the DB (`src/initialize.ts`)                   |

Build pipeline: **Vite 8 + Nitro** (`nitro-nightly`, preset `bun`), Nitro server
entry at `./server/server.ts` with otel/request-tracing plugins. Vite plugins:
`tailwindcss()`, `standaloneBundles()`, `nitro()`. The client bundle entry is
`src/client/index.tsx`; assets emitted to `assets/[name]-[hash]` with a build
manifest (read via `src/utils/manifest.ts`). The `standaloneBundles()` plugin
bundles 4 worker entry points with `Bun.build` into `.output/server/workers/`:
`ingester-worker.js`, `open-observe-worker.js`, `og-render-worker.js`,
`import-worker.js`. Path alias `@` → `./src`. Runtime requires `bun >= 1.3.14`.

Notable deps: hono, kysely, zod 4, iron-session, unstorage + ocache, `@atcute/*`
(atproto client/oauth/jetstream/identity), `@takumi-rs/image-response` + React 19
(OG image render only), pino + `@hono/prometheus` + `@opentelemetry/*`,
basecoat-css, envalid (env validation in `src/env.ts`).

## iOS App (`app/`)

Separate Expo/React Native workspace. Not relevant for web UI refactor.

## Workers, Logging & Observability

| Path                                 | Purpose                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/workers/ingester-worker.ts`     | Wraps `src/bsky/ingester.ts`; runs Jetstream ingest off-thread                            |
| `src/workers/og-render/`             | OG image render worker (React + `@takumi-rs/image-response`)                              |
| `src/workers/open-observe-worker.ts` | pino transport → OpenObserve log shipping                                                 |
| `src/workers/import/`                | CSV import processing worker (`index.ts`, `logic.ts`, tests)                              |
| `src/logger/index.ts`                | pino logger (`getLogger`/`destroyLogger`); redacts cookies                                |
| `src/metrics.ts`                     | prom-client metrics (image processing duration, active ops)                               |
| `src/pds/client.ts`                  | Self-hosted PDS support                                                                   |
| `./server/`                          | Nitro server entry + plugins (`otel-sdk.ts`, `request-tracing.ts`) — separate from `src/` |

Each worker is bundled standalone into `.output/server/workers/` (see Build &
Dev). The ingester worker posts `wideEvent`/`ready` messages back to the main
thread's pino logger.

## Context & Session (`src/context.ts`)

`AppContext` — singleton app deps: `db`, `kv`, `ingester`, `oauthClient`,
`resolver`/`baseIdResolver` (DID/handle), `getSessionDid()` (fast cookie-only
DID), `getSessionAgent()` (OAuth `SessionClient`), `getProfile()`,
`serviceAccountAgent` (for `@bookhive.buzz` writes, when
`BOOKHIVE_SERVICE_HANDLE`/`BOOKHIVE_APP_PASSWORD` set), `addWideEventContext`.

Hono context vars (`c.get`): `ctx`, `assetUrls`, `requestId`, `wideEventBag`,
`appLogger`, `requestError`.

`createAppDeps()` builds the logger, DB (+migrate +background VACUUM), the shared
KV (single SQLite connection, unstorage mounts: `search:`, `profile:`,
`identity:`, `follows_sync:`, `auth_session:`, `auth_state:`, `book_lock:`),
OAuth client, caching ID resolvers, and spawns the ingester worker. Sessions use
`iron-session` (180-day cookie) with an in-memory `SessionClient` cache and
auto token refresh. `getProfile` is read-through cached (`profile:` + did, 24h
revalidate / 30d TTL). `createContextMiddleware(deps)` wires per-request `ctx`
with lazy session/DID/profile resolution.
