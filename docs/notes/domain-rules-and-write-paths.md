# Domain Rules & Write Paths

Background for `src/core/`, the PDS-write "core + adapters" pattern, and the presentation
primitives in `src/pages/components/`. The through-line: a fact or a write rule restated at every
call site is a chance for the copies to disagree, and in every case below they already had.

## Domain encodings — each asserted in exactly one place

- **Authors are tab-separated** → `core/authors.ts`. `parseAuthors` **trims**, matching migration
  020's trigger (`trim(substr(...))`) — an untrimmed split disagrees with `hive_book_author` and
  yields an `/authors/` link that matches nothing. Never write `split("\t").join(", ")`; that
  spelling rendered `"A\t\tB"` as "A, , B".
- **One status enum**, `BOOK_STATUS` in `src/constants.ts`. A second copy in `types.ts` had lost
  `abandoned`, which is why `csv.ts` imported it and mapped Hardcover's "Stopped" shelf — a
  did-not-finish — to want-to-read.
- **Three rating scales** → `core/rating.ts`. `user_book.stars` is 1–10, `hive_book.rating` is
  ×1000, display is 0–5 — three orders of magnitude apart, so confusing the latter two is not a
  rounding error. `StarDisplay` takes a _display_ rating.
- **A `HiveId` from the wire must be narrowed, not cast** → `core/hiveId.ts`. `as HiveId` asserts
  the fact without checking it; that's how `/books/null` reached the database.
- **`resolveActorDid`** (`services/actor.ts`) is the one handle→DID. `isDid(x) ? x : resolve(x)`
  appeared verbatim at 12 sites, plus a multi-line ternary in `rss.ts`, plus
  `handle.startsWith("did:")` in `xrpc/router.ts` — which accepts `did:` alone or `did:%%%` and
  passes them straight to the resolver and a `userDid = ?` filter. Returns `null`, never throws:
  callers answer a miss differently. `GET /profile/:handle` was the worst prior answer — a bare
  `c.render(<Fragment>…)` with no `c.status()`, serving **200 OK** with "not found" in the body.
- **One JSON 401 body** — `authFailureBody` (`src/routes/authResponse.ts`). There were nine
  variants across four shapes (`{error}`, `{success,message}`, `{success,error}`,
  `{success,message:"Not authenticated"}`). The body now carries all four keys deliberately — its
  readers don't agree on which to read, and each is load-bearing somewhere (`bookApi.ts` reads
  `success`+`message`, the iOS uploader reads `error` verbatim, `code` is what a caller should
  branch on). It's prose rather than a bare code because it reaches installed iOS builds with
  nothing shipped.

## Every PDS-write pair is one core plus two adapters

A JSON handler for the hydrated UI and a form handler for the no-JS path are written separately,
and the _form_ copy is reliably the one missing a check — nobody exercises it. This has bitten four
times: `POST /books/` had no `progress_history` write; `POST /comments` had no Server-Timing/its
own wide-event keys; `/api/follow-form` mirrored a follow into `user_follows` **without checking
the PDS write succeeded**; `/api/unfollow-form` cleared `isActive` when `listRecords` had _failed_.

The cores are `updateBookRecord`, `upsertBuzz` (`services/buzzWrite.ts`) and
`followUser`/`unfollowUser` (`services/followGraph.ts`). Adapters own status codes and redirects;
the core owns the rules and returns a discriminated result, **never throws** — a util that throws
an HTTP-shaped exception forces every caller to catch and translate it.

- **A `user_book` strongRef lookup must filter on `userDid`.** Both buzz writers used to select
  `user_book` by `hiveId` alone, so the `book` ref published into the author's PDS pointed at
  whichever row SQLite returned first — a stranger's record.
- **The two book-write routes are adapters over one core.** `POST /books/` (form) and
  `POST /api/update-book` (JSON) both call `updateBookRecord`; the progress bounds check
  (`bookProgressProblem`), the progress ⇒ Reading/Finished inference (`nextReadingState`), and the
  `progress_history` append all live at or below it. Each used to live in only one of the two
  routes, so "does finishing a book stick when I save a page count?" depended on whether JS was on.
  Explicit progress saves finish a book at the exact final page/chapter, or at 100% when
  no exact counts are supplied. Exact counts take precedence over rounded percentages: 657/658
  can display 100% but must remain Reading. The shared lifecycle stamps the finish date in both
  the PDS write and optimistic paint, preserves explicit status choices and terminal statuses,
  and only rotates a re-read on an explicit Reading selection. KOReader's fraction-derived
  rounded percentage alone still infers Reading through `statusFromProgress` without counts.
- **The `book_lock` is enforced by the core, checked by the client.** `withBookLock`
  (`services/getBook.ts`) owns check-then-set-then-release and returns `{locked}` rather than
  throwing (adapters answer differently: an error page for the form, a JSON 429 for the API route).
  Only `POST /books/` used to check it, so a 429 could only ever be produced on the path nobody
  uses. On the client, `bookApi.ts` is the one write helper (`bookActions.updateBook`, used by
  `LibraryTable` and the import table for every status/rating/date/delete write) — it used to be
  `try { await fetch(…) } catch {}` with `res.ok` never read, so a refused write was silently
  swallowed and the table kept showing a value the server had rejected. `bookApi.ts` returns a
  discriminated result; `LibraryTable`'s `save`/`remove` roll the row back on failure.
- **A re-sync's cleanup must handle the empty case** — `pruneMirroredRecords`
  (`data/repoMirror.ts`). A re-sync deletes `user_book`/`buzz` mirrors the PDS didn't return, and
  `uri not in ()` isn't expressible — the admin backfill used to guard the whole delete on
  `keepUris.length > 0`, silently turning "the user deleted every record of this kind" into "change
  nothing". Empty is not a no-op; it's the strongest possible instruction.
- **The import worker is one pipeline, not three.** `processGoodreads/Storygraph/HardcoverImport`
  are descriptors over `processCsvImport` (`workers/import/logic.ts`), differing only in parser,
  accessors, identifier merge, record builder, fallback row, and unmatched payload. The three
  copies had drifted: StoryGraph's matched path used `normalizeStorygraphRating` while its
  unmatched-retry path open-coded `starRating * 2`, so a quarter-star row imported as `9` matched
  and `8.5` unmatched — into an integer column.

## Upsert `ON CONFLICT` sets are shared, not copied

- **`userBookUpsertSet`** (`src/db.ts`) — four writers (`upsertUserBook`, `refetchBooks`, the admin
  backfill, the Jetstream ingester) each kept their own 15-line `c.ref("excluded.…")` list and had
  already drifted (`upsertUserBook` omitted `userDid` and `createdAt`). Lives next to
  `feedActivityIndexedAt` (see `docs/notes/activity-feed.md`) since that expression is the most
  load-bearing part of the clause.
- **`buzzUpsertSet`** — four writers, two drifted. The admin backfill's set was four columns, so
  re-indexing an edited buzz left `bookUri`/`bookCid` stale — the strongRef that had already once
  published a stranger's record — and omitted `userDid`, so a backfill couldn't repair a
  mis-attributed row. The ingester omitted `createdAt` while `refetchBuzzes` included it, so an
  edited comment's date depended on whether the firehose or a re-sync indexed it last.

## Listing order — every paginated listing ends on a unique key

- **`personal_book`**: every OPDS feed and `getPersonalLibrary` end their `ORDER BY` on
  `personal_book.id`. Neither `createdAt` (millisecond ISO) nor `title` is unique, and SQLite may
  order ties differently between two `LIMIT`/`OFFSET` pages — serving one book twice, another
  never, which an e-reader can't detect.
- **Catalogue listings** (`data/catalogBooks.ts`): all four consumers end on `hive_book.id`. They
  used to stop at `ratingsCount, rating`, neither unique (`ratingsCount = 0` is the common case
  across 356k books). `src/data/catalogBooks.test.ts` pins it by paging through an all-tied set.
- Counting stays index-only where possible: `listBooksByAuthor` counts `hive_book_author` alone
  (a prior XRPC copy joined `hive_book`, fetching a row from the 1.62 GB table per counted row for
  a number the index already has); `listBooksByGenre` only joins when a `q` filter forces it, and
  in that case the count and data query must share the same predicate or the pager advertises a
  last page that renders empty.

## The cover a user sees is their own, on every transport

OPDS points each entry at `/opds/books/:hash/cover`, serving the local cover and falling back to
the catalogue's. The four XRPC personal-library methods used to do the opposite
(`hiveCover ?? hiveThumbnail ?? local`), so the same file showed a stock catalogue thumbnail in the
iOS app and web library, and the user's own cover only on their e-reader. Local wins now on all
four; `hasLocalCover` travels with the result because `coverUrl`'s local form needs a session
cookie a service-auth client doesn't have.

`JSON.parse(progressData)` for sync documents is guarded once, in the shared read layer
(`data/syncDocuments.ts`), rather than at each of the five readers — it used to be unguarded in
four of them, so one malformed blob 500'd both KOSync routes and both XRPC methods while the web
page silently rendered 0%.

## Presentation primitives — asserted once, drift is visible not latent

Same lifting rule, one layer up: what it catches here is a user noticing one page doesn't look like
another. All live in `src/pages/components/` and are the only correct source for their thing:

- **`icons.tsx`** — 102 inline `<svg>` elements across 38 files, 40 of them copies (two magnifiers
  in two text inputs, three star glyphs on one page). `Icon` (stroked) / `SolidIcon` (filled) is
  the attribute recipe, written out ~35 times in two spellings before this. `bookInfo.tsx` had
  spelled `fill-rule`/`clip-rule` as React's `fillRule`/`clipRule`, which hono/jsx passes through
  verbatim — the attribute never applied.
- **`ProgressMeter.tsx`** — eight rails at three heights; two had lost the width transition, and
  "finished is green" was open-coded at four of them.
- **`TimeAgo.tsx`** — strict wording, `<time datetime>` carrying the absolute time in `title`. Only
  one prior site obeyed this; six others emitted a bare fuzzy string.
- **`FilterableDirectory.tsx`** — `/explore/genres` and `/explore/authors` are the same page; their
  rows had different tap-target heights and transition properties.
- **`ShareMenu.tsx`, `ThemeToggle.tsx`, `Pagination.tsx`** — same story, each documented in its own
  file.

`ShareMenu` and `FilterableDirectory` render their own `<Script>`/`<script>` and bind idempotently
over data attributes rather than ids — forced, not stylistic: `Script` stringifies its callback, so
a handler can't close over a per-instance name. `ShareMenu` awaits clipboard writes before
announcing success and reports rejection through its live status region; denied clipboard access
must never flash ‘Copied!’. Escape closes an expanded menu and returns focus to its trigger.

## Islands mount through `client/islands.ts`, which owns the guard

Six islands used to be bootstrapped six ways in the same `DOMContentLoaded` listener; one guarded
its `JSON.parse` and `.catch`ed its import, the next block didn't, so a malformed `data-books`
threw out of it and skipped every island registered after. `jsonAttr` also takes a validator —
`data-books="null"` parses fine and then throws inside `[...books].sort()` at render time, inside a
promise nobody was catching. Failure policy is uniform and quiet: an island that can't mount leaves
the server-rendered markup, which is a working page and all a no-JS visitor ever gets.

## Profile pages-read total uses the detailed stats calculation

The profile's all-time Pages Read uses `computeReadingStats(books, []).pagesRead`, the same
finished-book filter and page-count precedence as detailed reading stats. Summing `getPageCount`
over the whole library inflated the total with want-to-read, currently-reading and abandoned
books. User-recorded edition totals take precedence over catalogue metadata; missing page counts
contribute zero. Keep this scope shared rather than reintroducing a profile-only sum.

## CSV imports validate headers before permissive row parsing

The shared worker pipeline calls `csvHeaderProblem` before invoking any service parser or
fetching/writing PDS records. Goodreads requires Book Id/Title/Author, StoryGraph Title/Authors,
and Hardcover Title/Author/Status. Missing or unreadable headers emit actionable `import-error`
and stop; otherwise the lenient parsers silently dropped every row and reported successful zero
imports for unrelated CSV files. Validate identity columns, not the resulting book count:
header-only exports are valid empty libraries, and valid all-existing imports are still success.

Import error events distinguish terminal failures with `stage: "error"`; partial batch-save
errors keep `stage: "uploading"`. The import island stops progress/spinner and offers Try again
only for terminal failures, while retaining partial-save errors alongside ongoing progress.
The browser's network/stream catch also emits the terminal stage. Retry uses the same clear-and-
reload action as Import more after success, restoring the service/file chooser.

## Profile library writes reconcile and serialize per book

`client/components/libraryTableStore.ts` keeps a confirmed row and ordered optimistic edits
for each book. Writes for one book run serially; each canonical `UserBookView` replaces confirmed
status/dates/progress before later pending edits are replayed. A rejection drops only that edit,
so an earlier response cannot erase a newer choice. Deletion waits behind saves and blocks new
edits until it completes; a failed delete restores the latest confirmed row. Progress payloads
assert only progress, letting the shared lifecycle infer Reading/Finished; resending the row's
old status suppressed that inference. `PageInput` follows replaced progress props for rollback.
