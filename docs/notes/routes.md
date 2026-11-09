# Routes Reference

Full route-by-route breakdown. `AGENTS.md`'s Routes section has the prefix → router-file map and
the cross-cutting gotchas (etag, caching policy); this is where to look once you know which router
you're touching.

Public image responses under `/images/*` and `/og/*` override the global security middleware
with `Cross-Origin-Resource-Policy: cross-origin` so other sites can embed them. The override
must unwind after `secureHeaders()`; other routes retain `same-origin`. This does not add CORS
headers, which ordinary image embedding does not require.

`src/app.ts` mounts infra/admin routes, then `/` → `src/routes/main.tsx` (`mainRouter`). `mainRouter` registers standalone pages, the image proxy, feature route modules, and the XRPC router.

`src/pages/layout.tsx` normalizes same-host crawler URLs to the scheme/port in `PUBLIC_URL`.
TLS termination can leave `c.req.url` as HTTP: using it verbatim advertised HTTP OG/Twitter
images, logos and page URLs on HTTPS pages. Both relative and absolute same-site images are
normalized; external images and distinct PDS hosts keep their own origins. OAuth query secrets
remain stripped from page metadata. Local HTTP origins remain HTTP when configured that way.

### Mounted in `src/app.ts` (infra/admin, before `mainRouter`)

- `/healthcheck` → JSON status + git sha
- `/metrics` → Prometheus
- `/admin/*` → `src/routes/admin.ts` (gated by `EXPORT_SHARED_SECRET`). `GET /admin/backfill-catalog/progress` reads through the KV, not just process memory — the backfill runs for hours on the primary worker while the request can land on any of the three. Persist the status object directly, never `JSON.stringify` of it (unstorage runs `destr` on read; a stored JSON string reads back as an object and any `JSON.parse` of it throws).
- `/debug/*` → `src/routes/debug.ts` (gated by `EXPORT_SHARED_SECRET`)
- `/import` (POST `/goodreads`, `/storygraph`, `/hardcover`) → `src/routes/import.ts` — CSV import handler;
  `importLifecycle.ts` owns worker/timer cleanup; route-level `finally` releases metrics exactly
  once. Worker/heartbeat cleanup is immediate. Success drains ordered SSE output, still bounded
  by timeout/disconnect. Terminal errors drain before returning (Hono closes on callback return),
  with at most 1s grace; abort or the original deadline interrupts an existing drain. A timeout
  starting its own error drain gets only that 1s grace, never an unbounded wait. Error delivery
  remains best effort when output is blocked; abort/write failure returns without draining.
  Interrupted drains explicitly call Hono's supported `stream.abort()` before callback return,
  cancelling its underlying reader so blocked writes settle without client consumption. Merely
  returning would leave Hono's `close()` blocked and disable its later disconnect cancellation.
  Hono observes disconnects via `onAbort` (its underlying writer swallows transport rejections).
  Client EOF without a terminal event is an error, not completion. The first terminal event
  stops client reads and triggers best-effort cancellation without waiting for transport
  settlement; trailing events or cancellation errors cannot overwrite that terminal UI.
  Worker progress messages await acknowledgement after each SSE write, bounding the cross-thread
  backlog for slow clients; heartbeat writes also allow only one outstanding write.

`/admin/export` prepares its sanitized files in a short-lived worker and streams tar/gzip.
A dedicated SQLite lock spans preparation, download, child termination and cleanup across
web processes; contention returns `503` with `Retry-After: 60`. Cancellation waits for the
worker to acknowledge native SQLite completion rather than assuming termination stopped it.
Unexpected worker failure keeps ownership fail-closed; see `memory-and-runtime.md` before
clearing crash leftovers or restarting a holder. Authentication and auth-table exclusion remain
unchanged.

Multipart ebook uploads and CSV imports authenticate and acquire separate, zero-wait,
one-job-per-web-process admissions before parsing their bodies. Actual received bytes are
bounded before `formData()` materializes a file, including requests without Content-Length.
Admissions span upload processing or the import worker/SSE lifetime, not just parsing.
CSV processing counts in a first pass, then processes bounded row groups; its unmatched report
is still complete. Imports enumerate only book records from the PDS in pages, preserving their
original record keys. Worker progress messages await SSE acknowledgement, so slow readers
cannot accumulate an unbounded cross-thread message queue. Remaining retained input/report
limits and runtime resource counters are described in `memory-and-runtime.md`.

### Mounted in `src/app.ts` (after `mainRouter`)

- `/sitemap.xml` → static sitemap

### Standalone pages in `src/routes/main.tsx`

- `/privacy-policy` → `src/pages/privacy-policy.tsx`
- `/legal` → `src/pages/terms.tsx`
- `/pds` → `src/pages/pds.tsx` (redirects to `/` if PDS disabled); repository enumeration and profile reads use bounded SWR caches — `data-and-caching.md`
- `/` → `src/pages/marketing.tsx` — landing for signed-out visitors; loads SWR-cached highlights (`src/data/landingHighlights.ts`) and community totals (`src/data/communityStats.ts`); **302s to `/home` when the `sid` cookie is present**, which is why `Vary: Cookie` matters on this route
- `/images/*` → signing reverse-proxy to **imgproxy** (`src/routes/imageProxy.ts`). Three route shapes:
  - `/images/books/:hiveId?w=N` — ID-keyed canonical (preferred). Helpers: `coverImageUrl`, `avatarImageUrl`
  - `/images/avatars/:did?s=N` — ID-keyed avatar
  - `/images/{modifiers}/{source}` — source-embedded catch-all (used by OG render, iOS app). Helpers: `sourceCoverImageUrl`, `sourceAvatarImageUrl`
- `/login`, `/logout`, `/oauth/callback` → `src/auth/router.tsx`

The image proxy allowlist is checked before the narrow Goodreads cover-filename repair shared
with ingestion; historical malformed sources are repaired without DB writes or arbitrary retries.
See `enrichment-and-scraping.md`.

The login handle suggestions use `public/js/actor-typeahead.js`, calling
`https://typeahead.waow.tech/xrpc/tech.waow.typeahead.searchActors` directly from the browser
with `q`/`limit` and `X-Client: bookhive.buzz`. Only handles and optional avatars are consumed;
the service does not provide authenticated `viewer` state. This changes discovery only, not
OAuth handle resolution.

### `src/routes/pages.tsx` (mounted at `/`)

- `/my-books` → `src/pages/myBooks.tsx` — authenticated tracked-book management, private/no-store; reads `listAllUserBooks` for the viewer only
- `/home` → `src/pages/home.tsx` — authenticated home (redirects to `/login` if no profile)
- `/feed` → `src/pages/feed.tsx` — activity feed (friends/all/tracking, keyset-paginated 25/page via `?cursor=`). A thin adapter over `getActivityFeed` (`src/data/activityFeed.ts`) — see `docs/notes/activity-feed.md`
- `/app` → `src/pages/app.tsx` — iOS app landing
- `/import` → `src/pages/import.tsx` — CSV import page, SSE progress
- `/search` → `src/pages/searchResults.tsx` (zValidator query `q`/`page`/`lang`)
- `/explore` → `src/pages/explore.tsx` — Discover hub (`?lang=`)
- `/explore/genres` → `src/pages/genres.tsx`; `/explore/genres/:genre` → `src/pages/genreBooks.tsx`
- `/explore/authors` → `src/pages/authorDirectory.tsx` (`?lang=`)
- `/authors/:author` → `src/pages/authorBooks.tsx`
- `/genres`, `/genres/:genre` → 301 redirects to `/explore/genres`
- `/.well-known/atproto-did` → returns DID constant

`?lang=` on all of the above is validated against `getAvailableLanguages` via `resolveLanguage` (`src/data/getLanguages.ts`), never passed through — it keys a cached aggregate and sits in the anon page cache's `ALLOWED_QUERY_PARAMS`. See `docs/notes/data-and-caching.md`.

### `src/routes/profile.tsx` (mounted at `/`)

- `/refresh-books` → re-sync books, then buzzes, alongside Popfeed shelves/items from PDS (auth), linked from Settings → Book sync. This repairs missed Jetstream events without deleting/recreating shelves. Incomplete/failed scans return an error rather than a successful refresh; each collection prunes only after cursor exhaustion. Login runs these recovery scans without blocking and logs rejected work.
  Both sync operations settle before responding, including on failure; rejected syncs still produce a 500.
- `/profile` → redirects to the resolved usable handle, with DID fallback on invalid/unavailable identity
- `/profile/:handle` → `src/pages/profile.tsx` — profile, shelves, follow counts, lists, genre stats
- `/profile/:handle/image` → redirect to avatar
- `/profile/:handle/stats` → redirect to current year; `/profile/:handle/stats/:year` → `src/pages/readingStats.tsx`

### `src/routes/books.tsx` (mounted at `/books`)

- GET `/:hiveId` → `src/pages/bookInfo.tsx` — book detail. `hiveId` must match `^bk_[A-Za-z0-9]+$`. Stale books (>30d) queued for enrichment; `?force-refresh=true` enriches inline with 15s ceiling
- DELETE `/:hiveId` → delete book from PDS + DB
- POST `/` → add/update book (zValidator form). Answers `{ success, userBook: UserBookView }` when `Accept` includes `application/json`, otherwise a 302 back to the book (the no-JS path)
- GET `/:hiveId/comments` → `src/pages/comments.tsx`

**`UserBookView`** (`src/core/userBookView.ts`) is the one shape every book-state write returns and read answers with — the `user_book` row minus `userDid`/`record`, with `owned` as a boolean — so a client can reconcile an optimistic update against what was actually written.

### `src/routes/comments.tsx` (mounted at `/comments`)

- POST `/` → create/update buzz; DELETE `/:commentId` → delete buzz
  Deletion negotiates HTML/JSON consistently for success, PDS rejection and transport errors.
  Accept ranges, quality values and explicit `q=0` exclusions are respected, with HTML as the
  fallback. Failed remote deletion leaves the local mirror intact.

### `src/routes/shelves.tsx` (mounted at `/shelves`)

User book lists ("shelves"). Uses **popfeed** lexicons (`social.popfeed.feed.list`/`.listItem`). Delegates to `src/services/lists.ts`.
Profile/shelf parameters accept handles or DIDs; generated navigation and forms prefer a usable
handle for readability, falling back to the owner's DID when invalid or unavailable.

- GET/POST `/new` → create list
- GET `/:handle` → user's shelves; GET `/:handle/:rkey` → single shelf
- GET/POST `/:handle/:rkey/edit`, POST `/:handle/:rkey/delete`
- POST `/add`, POST `/:handle/:rkey/add`, POST `/:handle/:rkey/remove`
- POST `/:handle/:rkey/reorder` → validated JSON `{ itemUris }`, owner-only; calls the same
  `reorderListItems` core as XRPC. Ranked shelves expose inline-JS earlier/later controls with
  explicit Save/Cancel; failed saves retain the draft and report an inline error.

### `src/routes/settings.tsx` (mounted at `/settings`)

- GET `/` → `src/pages/settings.tsx` (auth)
- POST `/delete-account` → delete account + revoke OAuth + destroy session
- `/sync/*` → `syncCredentialRoutes` (`src/routes/syncCredentials.tsx`), also mounted under `/library`
- GET `/sync/documents`, POST `/sync/link` → sync document management

### `src/routes/library.tsx` (mounted at `/library`)

Ebooks & Devices (the existing personal-library URLs): ebook uploads, e-reader credentials, sync documents. All auth-required.

- GET `/` → `src/pages/library.tsx`
- POST `/upload` → multipart upload. A thin adapter over `uploadPersonalBook` (`src/services/uploadPersonalBook.ts`) — the same core the XRPC procedure calls. Content-negotiated: JSON for mobile, `302 /library?error=<code>` for browsers. No `bodyLimit()` middleware.
- GET `/covers/:hash` → cover image; GET `/books/:hash/download` → file download (shares `streamPersonalBook` with OPDS)
- GET `/shelves` → JSON shelf list with counts
- `/sync/password`, `/sync/rotate` → the same `syncCredentialRoutes` router `/settings` mounts (iOS calls `/settings`, web calls `/library`)
- GET `/sync/documents`, POST `/sync/link`, POST `/sync/dismiss`, POST `/sync/rename`, POST `/sync/delete`

### `src/routes/api.tsx` (mounted at `/api`)

- GET `/user-book?hiveId=` → `{ userBook: UserBookView | null }` for the signed-in viewer. Cookie DID only (`getSessionDid`) — no OAuth restore, never touches the PDS
- POST `/update-book` → JSON write; returns `{ success, message, userBook: UserBookView }`
- POST `/update-comment` → create/update a buzz on a book
- POST `/follow`, `/follow-form`, `/unfollow`, `/unfollow-form`

### `src/routes/rss.ts` (mounted at `/rss`)

- GET `/user/:handle`, `/book/:hiveId`, `/friends/:handle` → RSS 2.0 feeds. All three share `activityRows` + `rssFeed` + `rssItem`, ordered and dated by `indexedAt` — see `docs/notes/activity-feed.md`.

### `src/routes/opds.ts` (mounted at `/opds`) — e-reader catalog

Serves personal library to e-readers. Auth via `src/middleware/opds-auth.ts` (HTTP Basic, same derived password as KOSync). **Dual-format**: OPDS 1.2 XML or 2.0 JSON based on `Accept` header.

- GET `/` → root navigation feed
- GET `/all`, `/shelves/:id`, `/search/results` → acquisition feeds (paginated at 24)
- GET `/search` → OpenSearch description. Accepts both `q` and `query` params.
- GET `/books/:hash/download/{name}.ext`, `/books/:hash/cover`

The trailing `{name}` is required (no name-less fallback) and produced by `core/downloadFilename.ts`'s `canonicalDownloadFilename`; the acquisition rel is `.../acquisition/open-access`, not the bare form; feed links use the request's own origin except the download link, which honours `OPDS_DOWNLOAD_BASE_URL`. Full reasoning: `docs/notes/e-reader-and-sync.md`.

### `src/routes/og.tsx` (mounted at `/og`) — OG images

- `/marketing`, `/book/:hiveId`, `/profile/:handle`, `/profile/:handle/stats/:year`, `/author/:author`, `/genre/:genre`, `/app` → `image/webp`

Failed renders serve `public/og-fallback.png` at 200, never 500. `renderOnce` deduplicates concurrent requests for the same card. **No server-side OG cache** — Cloudflare is the cache; don't add one without measuring the repeat rate (historically ~4%).

### `src/routes/sync/kosync.ts` (mounted at `/kosync`) — KOReader sync

Auth: `x-auth-user` (handle) + `x-auth-key` (md5 of HMAC-derived password). Progress stored in `sync_document`, bridged to `user_book.bookProgress`. Deferred PDS writes queued in KV and flushed when a session agent is available.

- POST `/users/create` → 403 (directs to BookHive Settings)
- GET `/users/auth` → validate credentials
- PUT `/syncs/progress` → push progress; GET `/syncs/progress/:document` → pull progress
- GET `/syncs/documents` → list all synced documents

A KOSync `document` id isn't necessarily a content hash, and the client's `metadata` payload (when sent at all) uses its own separators and may send a filename as `title`. Matching runs through `matchSyncDocumentForUser` → `matchSyncDocument`'s three tiers, where a wrong link is treated as worse than no link. Full account: `docs/notes/e-reader-and-sync.md`.

### Shared route helpers

`src/routes/lib.ts` — `cacheControl`, `searchBooks`, `ensureBookIdentifiersCurrent`, `refetchBooks`, `refetchBuzzes`, `refetchLists`, `syncFollowsIfNeeded`.

`src/routes/syncCredentials.tsx` — the KOSync/OPDS derived password, mounted at both `/settings/sync` and `/library/sync` (iOS calls the first, web the second).

`src/routes/errorPage.tsx` — **`renderError(c, {status, message, description?, title?})`**, and it sets the status once. `ErrorPage`'s `statusCode` prop is display-only, so a route that skips `c.status()` can serve a page reading "404" with a 200 OK status line — always call `renderError`, not a bare render of `ErrorPage`.
