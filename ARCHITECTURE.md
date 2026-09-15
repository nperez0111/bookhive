# BookHive Server — Architecture

How `src/` is organized below the transport layer: the four-layer module split, the shared read
layer that keeps HTML/XRPC/OPDS/RSS/KOSync from re-deriving the same queries, and the specific
modules whose reasons for existing aren't obvious from their names. See `AGENTS.md` for the route
map, page/component tables, and DB schema; see `docs/notes/*.md` for the incident-level detail
behind individual rules.

## The four layers (`src/lib`, `src/core`, `src/data`, `src/services`)

`src/utils/` no longer exists — it was four layers wearing one name, and nothing stopped a page
component from transitively importing `node:crypto` and the imgproxy signing key.

**One allowed direction, and only this one:**

```
routes │ xrpc │ pages │ client │ middleware        (transports & view)
        └──────────────► services ──► data ──► core ──► lib
                             │          │
                             └──► workers/ scrapers/ bsky/ auth/
                                  platform: db.ts, sqlite-kv.ts, context.ts,
                                  types.ts, constants.ts, env.ts
```

**Which bucket a new file goes in — answer the first question that is "yes":**

1. Does it build a `Response`, read `c.req`, or choose a status code? → **not** a util; it belongs
   in `routes/`, `xrpc/` or `middleware/`, or needs splitting into a core plus an adapter.
2. Does it take a `SessionClient`, spawn a Worker, or call a scraper? → **`services/`**. Must
   return a discriminated result and never throw an HTTP-shaped exception.
3. Does it read or write application tables (takes a `Database`) or a named KV mount? →
   **`data/`**. (A bare `Storage` parameter with no mount name — e.g. `readThroughCache.ts` — is
   mechanism, not this; it's `lib/`.)
4. Does it name a BookHive concept — a book status, a hiveId, a rating scale, the author separator,
   a lexicon field? → **`core/`**.
5. Otherwise → **`lib/`**.

| Layer           | May import                              | Contents                                                                                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/`      | nothing of ours                         | `semaphore` `circuitBreaker` `readThroughCache` `batchTransform` `lazy` `pagination` `dateInput` `xml` `htmlToText` `formatBytes` `formatCount` `viewTransitionName` `buildUrl` `contentDisposition` `errors` `manifest`                                                                                          |
| `src/core/`     | `lib`, `types`, `constants`             | `authors` `rating` `hiveId` `bookProgress` `bookMeta` `userBookView` `imageUrl` `filenameMatching` `bookMatching` `downloadFilename` `importBook` `csv` `ftsQuery` `cacheHeaders` `generateInitialsAvatar` `bookLifecycle` `readingYear` `enrichVerdict` `bookMetadata/`                                          |
| `src/data/`     | `core`, `lib`, `db`                     | `activityFeed` `authorStats` `exploreGenres` `readingStats` `catalogBooks` `personalBooks` `personalLibrary` `syncDocuments` `syncMatching` `syncBridge` `bookIdentifiers` `enrichQueue` `hiveBookGenres` `getLanguages` `dbExport` `bookDetail` `profileSummary` `socialCards` `landingHighlights` `userShelves` |
| `src/services/` | all of the above + workers/scrapers/PDS | `getBook` `userBookStore` `bookRecordWrite` `userBookFollowUp` `buzzWrite` `followGraph` `lists` `getFollows` `getProfile` `deleteAccount` `catalogBookService` `ensureBookCataloged` `uploadImageBlob` `uploadPersonalBook` `convertToEpub` `enrichBookData` `searchBooks`                                       |

Two deliberate exceptions: `core/bookMetadata/` moves whole even though sub-files need
`@resvg/resvg-js`/`Bun.file` (a cohesive parser package); `data/personalLibrary.ts` touches the
filesystem (splitting "where the file is" from "which bytes we serve" would undo why
`streamPersonalBook` exists).

`imageProxy` is the shape to copy when splitting a file like this: URL builders live in
`core/imageUrl.ts`, the `Response`-building proxy in `routes/imageProxy.ts` next to its only caller
— most importers only ever wanted the URL builders.

**`mock.module()` paths are strings, so a directory move doesn't update them** — grep for stale
`mock.module("../../utils/...")` paths after any move; failures surface in unrelated files that
pass in isolation, since `mock.module` is process-wide.

## Shared read layer (`src/data/`)

**Every read that more than one transport answers lives here, and the transports are thin adapters
over it.** BookHive has five transports — HTML pages, XRPC, OPDS, RSS, KOSync — and a query written
directly into whichever transport needed it first is a query the others will independently
re-derive and eventually disagree with.

The rule: if two transports show the same thing, the query and the row→wire shaping belong here;
only pagination, status codes, and wire field names stay in the adapter.

| File                   | Owns                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bookDetail.ts`        | `getViewerBook`, `listBookActivity`, `countBookReviews`, `listOtherBooksByAuthor`, `listProgressHistory`, `listShelvesHoldingBook`, `listBookDiscussion` — `/books/:id`, `/books/:id/comments`, XRPC `getBook` |
| `profileSummary.ts`    | `isBuzzer`, `isFollowing`, `getFollowCounts`, `getFollowDids`, `getGenreCounts`, `listRecentProgress` — `/profile/:handle`, the stats page, XRPC `getProfile`                                                  |
| `socialCards.ts`       | `getBookCardStats`, `getProfileCardStats`, `getAuthorCardStats`, `getGenreCardStats` — the five `/og/*` cards                                                                                                  |
| `landingHighlights.ts` | `getLandingHighlights` — `/`'s trending + recent lists, SWR-cached inside the helper                                                                                                                           |
| `userShelves.ts`       | `listShelf`, `listAllUserBooks`, `getReadingCounts` — `/home`, `/my-books` and the profile shelf tabs                                                                                                          |
| `catalogBooks.ts`      | `listBooksByAuthor`, `listBooksByGenre`, `hydrateSearchResults` — `/authors/:author`, `/explore/genres/:genre`, XRPC `getAuthorBooks`, the genre branch of XRPC `searchBooks`, `/search`                       |
| `personalBooks.ts`     | `listPersonalBooks`, `getPersonalBookRow`, `personalBookView`, `shelfIdsForBooks` — the three OPDS acquisition feeds and four XRPC methods                                                                     |
| `syncDocuments.ts`     | `listSyncDocuments`, `getSyncDocument`, `syncProgressView`, `parseSyncProgress` — both KOSync REST routes, both XRPC methods, `/library/sync/documents`                                                        |

No SQL lives in `src/pages/` — a query inside a JSX component is structurally unreachable by
XRPC/OPDS/RSS. `listShelf` takes its sort key as a parameter rather than unifying it: **Currently
reading** sorts by `indexedAt` (an activity list), **Want to read** by `createdAt` (a queue) — see
`docs/notes/activity-feed.md`. Catalogue `ORDER BY` tie-breaking, cover-selection precedence, and
the guarded `JSON.parse(progressData)`: `docs/notes/domain-rules-and-write-paths.md`.

## Modules with a note worth keeping

The layer table above lists every file. These are the ones whose _why_ isn't guessable from the
name — full stories in the linked `docs/notes/*.md`.

| File                             | Note                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `services/getBook.ts`            | Book record CRUD against the PDS; `updateBookRecord` is the interactive write — `domain-rules-and-write-paths.md`             |
| `services/userBookStore.ts`      | `user_book` row read/upsert + `recordFromUserBook`; split from `getBook.ts` to avoid an import cycle                          |
| `services/bookRecordWrite.ts`    | CAS write of a book record (`putRecord`/`swapRecord`, `createRecord` for new) — no unguarded variant                          |
| `services/userBookFollowUp.ts`   | Deferred cover-blob upload + `hiveBookUri` patch after the response; CAS'd, 3 re-apply attempts on conflict                   |
| `data/enrichQueue.ts`            | Producer + primary-worker drain + `retry`/`defer`/`dead` accounting — `enrichment-and-scraping.md`                            |
| `lib/circuitBreaker.ts`          | Three-state breaker, **`auth/restore-guard.ts` only** — wrong for scraping — `enrichment-and-scraping.md`                     |
| `lib/readThroughCache.ts`        | KV read-through, TTL + optional SWR `revalidateAfter`; prefer SWR for anything expensive                                      |
| `data/activityFeed.ts`           | The one activity-feed implementation — `activity-feed.md`                                                                     |
| `data/authorStats.ts`            | `/explore` author aggregates, SWR-cached, `INDEXED BY idx_hive_book_stats` — `data-and-caching.md`                            |
| `services/uploadPersonalBook.ts` | The one "put this ebook in this user's library" — both upload adapters call it                                                |
| `data/syncMatching.ts`           | KOReader document → book matching (3 tiers) — `e-reader-and-sync.md`                                                          |
| `core/filenameMatching.ts`       | Filename-derived identity: `koreaderFilenameHash`, `filenameKey`, `titlesEquivalent`, `authorsMatch`                          |
| `core/bookMatching.ts`           | Fuzzy title scoring (`similarityScore`, `contentWords`), ported from MIT-licensed shelfcheck                                  |
| `lib/errors.ts`                  | `errorMessage`/`toErrorPayload`/`truncateForLog` — the one "unknown thrown" shape, bounded at `MAX_LOG_CHARS`                 |
| `core/authors.ts`                | Tab-separated authors encoding, `parseAuthors` trims — `domain-rules-and-write-paths.md`                                      |
| `core/rating.ts`                 | The three rating scales and their conversions                                                                                 |
| `core/bookProgress.ts`           | `bookProgressProblem` (bounds) + `statusFromProgress` (progress ⇒ Reading/Finished)                                           |
| `core/enrichVerdict.ts`          | `retry`/`defer`/`dead` verdict type + `verdictFields`, defaults to `defer` — `enrichment-and-scraping.md`                     |
| `core/readingYear.ts`            | "Books finished in year N" — UTC boundaries, re-reads count — `activity-feed.md`                                              |
| `core/bookLifecycle.ts`          | `nextReadingState` — the one reading-state transition, owns re-read rotation                                                  |
| `services/actor.ts`              | `resolveActorDid` — the one handle→DID, returns `null` rather than throwing                                                   |
| `data/repoMirror.ts`             | `pruneMirroredRecords` — re-sync cleanup; handles the empty-keep-list case — `domain-rules-and-write-paths.md`                |
| `routes/authResponse.ts`         | The one JSON 401 body — `domain-rules-and-write-paths.md`                                                                     |
| `services/searchBooks.ts`        | The one catalogue-ensure + concurrency ceiling — `enrichment-and-scraping.md`                                                 |
| `data/bookDetail.ts`             | `/books/:id`, comments, XRPC `getBook`; every ordering ends on `uri`                                                          |
| `core/hiveId.ts`                 | `HIVE_ID_PATTERN`/`isHiveId`/`asHiveId` — narrow the wire value, don't cast it                                                |
| `core/cacheHeaders.ts`           | The one caching rule (signed-in vs signed-out)                                                                                |
| `data/exploreGenres.ts`          | `getTopGenres`, SWR-cached, four consumers including XRPC `listGenres`                                                        |
| `data/readingStats.ts`           | `getReadingStatsForYear` + the `MIN_BOOKS_FOR_YEAR_STATS` fallback                                                            |
| `data/syncBridge.ts`             | `recordSyncProgress` — the one e-reader progress push; `enqueuePdsWrite` for the deferred write                               |
| `data/personalLibrary.ts`        | Library paths, `streamPersonalBook` — `e-reader-and-sync.md`                                                                  |
| `services/buzzWrite.ts`          | The one buzz create/update — `domain-rules-and-write-paths.md`                                                                |
| `services/followGraph.ts`        | The one follow/unfollow — PDS write first, `user_follows` mirrored only on success                                            |
| `lib/formatBytes.ts`             | Quota byte formatting; `app/utils/personalLibrary.ts` holds a deliberate byte-identical copy (Metro can't import from `src/`) |

## Reading navigation

`/my-books` reads the signed-in viewer's books through `listAllUserBooks` and renders
`pages/myBooks.tsx`. `pages/components/TrackedBooks.tsx` owns the LibraryTable mount,
serialized props, and no-JS cover grid shared with the owner's profile; there is no new island.
The grid includes every tracked status, including abandoned and status-less books.
