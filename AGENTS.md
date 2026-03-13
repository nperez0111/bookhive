# BookHive — Agent Reference Index

Goodreads alternative built on Bluesky's AT Protocol. Server-rendered Hono JSX with minimal client-side hydration via `hono/jsx/dom`. Bun runtime, SQLite via Kysely, Tailwind CSS v4.

## User preferences (do not remove this)

- Do not commit any changes to git

## Input Validation

Routes must always validate inputs using either:

- **zValidator** (with Zod) for standard Hono routes — use `zValidator("query", schema)`, `zValidator("json", schema)`, or `zValidator("form", schema)` as appropriate.
- **XRPC router validators** for AT Protocol XRPC endpoints in `src/xrpc/`. Add lexicons & regenerate the generated types with `bun run lexgen`

## Architecture at a Glance

```
Browser ──> Bun.serve() ──> Hono app ──> Server-rendered JSX pages
                │                             │
                │ /_bundle (HTML import)       ├── SQLite (Kysely ORM)
                │   └── entry.html             ├── KV cache (unstorage + SQLite)
                │       ├── src/client/index.tsx  ├── Bluesky PDS (ATProto writes)
                │       └── src/index.css      └── Goodreads scraper
                │
                └── static files (public/)
```

**Key pattern**: Server components (`src/pages/`) render full HTML. Only 3 islands are hydrated client-side (`src/client/`). Most interactivity is CSS-only (peer/checked selectors for tabs, dropdowns, modals) or inline `<Script>` vanilla JS.

## Entry Points

| File                   | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `src/index.ts`         | Bun.serve — HTML bundle route + Hono fetch handler |
| `src/server.ts`        | Creates app dependencies and Hono app              |
| `src/app.ts`           | Hono app factory — all middleware + route mounting |
| `src/entry.html`       | Bun HTML bundle entry (imports CSS + client JS)    |
| `src/client/index.tsx` | Client bundle entry — mounts 3 hydrated components |

## Routes

All routes composed in `src/routes/main.tsx` → `src/app.ts`.

- `/` → `src/pages/home.tsx` — landing, hero, book list, buzzes
- `/feed` → `src/pages/feed.tsx` — activity feed, friends/all/tracking tabs
- `/app` → `src/pages/app.tsx` — iOS app landing
- `/privacy-policy` → `src/pages/privacy-policy.tsx` — privacy policy
- `/import` → `src/pages/import.tsx` — Goodreads/StoryGraph CSV import, SSE progress
- `/explore` → `src/pages/explore.tsx` — explore hub
- `/explore/genres` → `src/pages/genres.tsx` — genre directory
- `/explore/genres/:genre` → `src/pages/genreBooks.tsx` — books by genre, paginated, sortable
- `/explore/authors` → `src/pages/authorDirectory.tsx` — author directory
- `/authors/:author` → `src/pages/authorBooks.tsx` — books by author, paginated
- `/genres`, `/genres/:genre` → legacy redirects to `/explore/genres`
- `/profile`, `/profile/:handle` → `src/pages/profile.tsx` — user profile, book shelves
- `/profile/:handle/stats` → `src/pages/readingStats.tsx` — reading stats by year
- `/refresh-books` → `src/routes/profile.tsx` — re-sync books from PDS
- `/books/:hiveId` → `src/pages/bookInfo.tsx` — book detail, status, rating, review, progress
- `/books/:hiveId/comments` → `src/pages/comments.tsx` — comments/reviews section
- `/comments` (POST/DELETE) → `src/routes/comments.tsx` — comment mutations
- `/api/update-book`, `/api/update-comment`, `/api/follow`, `/api/follow-form` → `src/routes/api.tsx` — JSON API
- `/login`, `/logout`, `/oauth/callback` → `src/auth/router.tsx` — OAuth auth flows
- `/import` (POST /goodreads, /storygraph) → `src/routes/import.ts` — CSV import handler
- `/admin/export` → `src/routes/admin.ts` — DB export
- `/xrpc/*` → `src/xrpc/router.ts` — AT Protocol XRPC endpoints
- `/images/*` → `src/routes/main.tsx` — IPX image proxy/transform

Shared route helpers: `src/routes/lib.ts` (searchBooks, refetchBooks, refetchBuzzes, syncFollows).

## Server-Side Pages (`src/pages/`)

Each file exports a Hono JSX component rendered server-side.

| File                 | Renders                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `layout.tsx`         | HTML shell — meta tags, asset injection, `<head>`/`<body>` wrapper |
| `navbar.tsx`         | Top nav bar with user menu, search mount point                     |
| `home.tsx`           | Landing page — hero, features, book list, buzzes                   |
| `bookInfo.tsx`       | Book detail — status, rating, review, progress, recommendations    |
| `profile.tsx`        | User profile — book shelves, stats                                 |
| `comments.tsx`       | Comments/reviews section                                           |
| `genres.tsx`         | Genre directory                                                    |
| `genreBooks.tsx`     | Books filtered by genre (paginated)                                |
| `authorBooks.tsx`    | Books filtered by author (paginated)                               |
| `import.tsx`         | Import page with SSE progress                                      |
| `login.tsx`          | Login form                                                         |
| `app.tsx`            | iOS app landing page                                               |
| `privacy-policy.tsx` | Privacy policy                                                     |
| `error.tsx`          | Error page                                                         |

### Shared Page Components (`src/pages/components/`)

| File                       | What                              |
| -------------------------- | --------------------------------- |
| `book.tsx`                 | Book card component               |
| `buzz.tsx`                 | Buzz/comment display              |
| `BookReview.tsx`           | Book review form/display          |
| `EditableLibraryTable.tsx` | Library table with inline editing |
| `ProfileHeader.tsx`        | Profile header with avatar/stats  |
| `modal.tsx`                | Modal dialog (CSS-based)          |
| `fallbackCover.tsx`        | Placeholder book cover            |

Inline JS helper: `src/pages/utils/script.ts`

## Client-Side Components (`src/client/`)

Only 3 hydration islands, mounted in `src/client/index.tsx`:

| Component        | Mount Point                   | File                                              |
| ---------------- | ----------------------------- | ------------------------------------------------- |
| `SearchBox`      | `#mount-search-box` (navbar)  | `src/client/components/SearchBox.tsx`             |
| `StarRating`     | `#star-rating` (book page)    | `src/client/components/StarRating.tsx`            |
| `ImportTableApp` | `#import-table` (import page) | `src/client/components/import/ImportTableApp.tsx` |

Client hooks/utils:

- `src/client/components/utils/useSearchBooks.ts` — search via XRPC
- `src/client/components/utils/useDebounce.ts` — debounce hook
- `src/client/components/utils/icons.tsx` — SVG icons
- `src/client/utils/debounce.ts`, `throttle.ts` — utility functions

## Data Layer

### Database (`src/db.ts`)

SQLite via Kysely. Schema + all migrations (001–010) in one file.

| Table             | Purpose                   | Key columns                                                           |
| ----------------- | ------------------------- | --------------------------------------------------------------------- |
| `user_book`       | User's book records       | uri (PK), did, hiveId, status, rating, review, startedAt, finishedAt  |
| `hive_book`       | Canonical book data       | id (HiveId), title, authors, cover, description, genres, series, meta |
| `hive_book_genre` | Genre-to-book mapping     | genre, hiveId                                                         |
| `book_id_map`     | ISBN/Goodreads cross-refs | hiveId, type, value                                                   |
| `buzz`            | Comments on books         | uri, did, hiveId, text, createdAt                                     |
| `user_follows`    | Cached follow graph       | did, followDid                                                        |

### KV Cache (`src/sqlite-kv.ts`)

SQLite-backed unstorage for: profiles, identity resolution, search results, auth sessions/state, follows sync timestamps.

### Key Data Utilities

| File                            | Purpose                             |
| ------------------------------- | ----------------------------------- |
| `src/utils/getBook.ts`          | Book record CRUD against user's PDS |
| `src/utils/getProfile.ts`       | Profile fetching from Bluesky       |
| `src/utils/getFollows.ts`       | Follow graph sync                   |
| `src/utils/enrichBookData.ts`   | Background Goodreads enrichment     |
| `src/utils/bookIdentifiers.ts`  | ISBN/ID normalization + persistence |
| `src/utils/bookProgress.ts`     | BookProgress serialization          |
| `src/utils/readThroughCache.ts` | KV read-through with TTL            |
| `src/utils/csv.ts`              | Goodreads/StoryGraph CSV parsers    |

## Types (`src/types.ts`)

All shared TypeScript types: `HiveId`, `UserBook`, `HiveBook`, `Buzz`, `BookProgress`, `SearchResult`, etc.

Constants: `src/constants.ts` — book status enums and display maps.

## AT Protocol / Bluesky

| File                      | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `src/bsky/ingester.ts`    | Jetstream firehose — ingests book/buzz records from all users |
| `src/bsky/id-resolver.ts` | DID/handle resolution with caching                            |
| `src/bsky/bookLookup.ts`  | Book identifier lookup + transformation                       |
| `src/bsky/lexicon/`       | Generated types + validators from lexicon schemas             |
| `lexicons/*.json`         | AT Protocol lexicon definitions (book, buzz, search, etc.)    |
| `lex.config.ts`           | Lexicon codegen config                                        |

## Scrapers (`src/scrapers/`)

| File           | Purpose                                       |
| -------------- | --------------------------------------------- |
| `goodreads.ts` | Search API scraper                            |
| `moreInfo.ts`  | Goodreads page scraper (genres, series, meta) |
| `getHiveId.ts` | HiveId generation (hash of title+author)      |
| `index.ts`     | `findBookDetails` entry point                 |

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

| Command                | What                                                  |
| ---------------------- | ----------------------------------------------------- |
| `bun run dev`          | Dev server with `--hot`                               |
| `bun run build`        | Production build (server + assets)                    |
| `bun run build:server` | `scripts/build-server.ts` — bundles server + tailwind |
| `bun run build:assets` | `scripts/build-assets.ts` — CSS + client JS           |
| `bun test`             | Run tests                                             |

Asset pipeline: `src/bundle-assets.ts` fetches `/_bundle` to extract Bun-generated CSS/JS URLs, injected into Layout. Production falls back to pre-built `public/output.css` and `public/js/client.js`.

## iOS App (`app/`)

Separate Expo/React Native workspace. Not relevant for web UI refactor.

## Context & Session (`src/context.ts`)

`AppContext` — request-scoped context with session, user DID, profile. `AppDeps` — singleton dependencies (db, kvStore, oauthClient, ingester). Session via `iron-session`.
