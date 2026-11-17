# BookHive Mobile App — Architecture

Expo SDK 58 / React 19.3 / React Native 0.88, strict TypeScript and expo-router.
Exact versions live in `package.json` and the shared root `bun.lock`.
See [README.md](README.md) for setup/build commands and
[release checks](../docs/notes/mobile-feature-parity.md) before shipping.
Paths below are relative to `app/`.

## Navigation and screen ownership

`app/_layout.tsx` puts `ThemeProvider` above the first `useColorScheme()` consumer,
then supplies authentication, the epoch-scoped QueryClient and navigation. A
provider returned by its consumer cannot supply that consumer's context.
The root waits for session restoration before choosing protected auth/main routes.

`expo-splash-screen` uses the transparent `bee.png` mark at 160 points on eggshell
(`#f9eabc`) or brown (`#3f2b08`), following the OS theme. The first JS surface's
`onLayout` dismisses it, not a font/network promise. `LaunchScreen` keeps that
centered mark and surface while theme/session restoration runs; saved app theme
takes over when read. It is static (including under Reduce Motion), with no minimum
display time. Theme context renders immediately with system defaults and exposes
`isLoaded`; protected navigation still waits for auth. Optional SpaceMono loading
or failure never blocks the shell or recovery UI. Splash config changes require
new native binaries; Expo Go/dev-client previews cannot validate the release splash.

| Route/module                                                      | Owns                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `app/(auth)/`                                                     | Login and registration                                           |
| `app/(tabs)/index.tsx`                                            | Home reading overview                                            |
| `app/(tabs)/my-books.tsx`                                         | Tracked books, public-shelf filter chips and direct Ebooks entry |
| `app/(tabs)/explore.tsx`                                          | Discover: search, community feed, genre/author browsing          |
| `app/(tabs)/me.tsx`                                               | Signed-in profile, CSV import and settings gear                  |
| `app/book/[id].tsx`, `app/books/[status].tsx`                     | Book detail and complete status shelves                          |
| `app/profile/[did].tsx`, `app/profile/[did]/stats.tsx`            | Public profiles and reading stats                                |
| `app/search.tsx`, `app/feed.tsx`, `app/explore/{genres,authors}/` | Search, feed and catalogue results                               |
| `app/lists/`                                                      | Public catalogue shelves and owner editing                       |
| `app/library/`, `app/sync/`                                       | Private Ebooks and e-reader setup                                |
| `app/settings.tsx`, `app/account.tsx`, `app/import.tsx`           | Preferences, account maintenance and CSV imports                 |

Only the four primary screens belong to `(tabs)`. Secondary routes push onto the
authenticated root native Stack above the retained tab shell. Hidden tab entries
do **not** provide native stack gestures. iOS swipe-back and Android Back pop real
history; direct links without history use `BackNavigationHeader`'s Home fallback.
Sign-out must protect every secondary route as well as the tabs.
SDK 58 keeps protected routes registered: the root supplies explicit `redirectTo`
destinations (`/(auth)/login` and `/(tabs)`) rather than relying on group inference.
Components use tree-scoped `useRouter()`; imperative navigation outside React stays
in `utils/navigation.ts`. Hrefs name complete routes, not nested navigator params.

Three domains must stay distinct: My Books tracks public AT Protocol book records;
catalogue shelves use public AT URIs; ebook shelves use private numeric IDs.
Public profile previews never import editable tracked-book rows.

| Component folder/module     | Boundary                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `components/tracked-books/` | `TrackedBooksContent` owns query/filter/sort/refresh and collection-level write feedback; `TrackedBookItem` uses existing mutation hooks |
| `components/home/`          | Currently-reading cover preview and public shelf entry points                                                                            |
| `components/profile/`       | `ReaderProfileScreen` serves own/public routes; three-book previews and expandable shelves/reviews                                       |
| `components/book-detail/`   | Progress/review drafts and progress editor presentation                                                                                  |
| `components/discovery/`     | Genre/author presentation; route retains language/category/search state and enables queries                                              |
| `components/ebooks/`        | Upload workflow, sync-document presentation and explicit progress selection                                                              |

My Books keeps navigation available through loading/errors. Write errors belong
to the collection: optimistic status changes can remove a row from its filter
before a failed request returns. Ownership is independent of reading status and
edited on book detail. Home/profile refresh failures retain cached content;
profile refresh reloads both reader data and public shelves.
Home shows only the currently-reading book preview. Home and profile previews use
the read-only `BookCoverGrid`, measured against their own container width. My Books
intersects a selected public shelf's catalogue IDs with tracked-book filters; it
never treats an unloaded shelf as all books. Pull-to-refresh reloads shelf membership.
The Home search action opens Discover, whose search field opens catalogue search.
Community feed entries use compact book rows rather than full-width cover cards.
Home's Community section is separate from the reader's personal Recent activity.

Action sheets, including Add to List, share `hooks/useSheetEntrance.ts` to animate
their full-screen backdrop opacity independently from the
sheet translation and respect Reduce Motion. Status controls use `BOOK_STATUS_OPTIONS`
labels, not the lowercase prose map. Descriptions expand once; comment display uses
the same HTML renderer without changing stored drafts. Removal stays centered at the
bottom of book detail and opens a themed confirmation.

On wide windows, book detail places the cover/community rating beside the reading
controls; narrow windows and larger text stack them. Description and discussion keep
the narrower reading width below both columns.
The fixed book header uses the short label "Book details" with Add to List and Share
actions on the right, without a duplicate action row in the body. The full title and author
wrap in the scrolling content above the cover, so long titles cannot enlarge the fixed
header. A centered, enlarged cover and
explicitly labelled community rating precede the personal reading controls. Personal
rating values belong in the disclosure summary, not repeated in its heading.

Book-detail sections use normal layout flow when editors expand. Do not add sibling
layout-position transitions: retained native-stack screens can leave later controls
overlapping an already-expanded progress editor when the page is reopened.

`hooks/useAdaptiveLayout.ts` sizes content from the current window, not the device
model, so rotation and Split View use the same rules. Tablet pages have centered,
bounded gutters; reading/forms use a narrower 760-point lane. Home uses independent
dashboard columns, catalogue results use two columns, and cover grids derive their
column count from available width and text scale. Larger accessibility text stacks
dashboard content. FlatLists change their key when the column count changes.
Shared headers keep full-width separators while their controls align to the page.

## Authentication and session isolation

`context/auth.tsx` owns `authFetch` (ofetch, `sid` cookie and app/platform headers);
`context/authSession.ts` owns session identity and request fencing. The API origin
is `EXPO_PUBLIC_API_URL`, defaulting to production even in development. Explicitly
set a reachable origin: localhost on a physical phone refers to that phone.

1. Login opens `/mobile/login?handle=…&redirect_uri=bookhive://oauth-callback`.
2. A validated callback supplies `{ did, handle, sid }`, stored in native
   SecureStore (`authState`), migrating legacy AsyncStorage credentials.
3. Launch refreshes via `/mobile/refresh-token` with an explicit restoring state.
4. Logout clears live credentials immediately, aborts old requests and tears down
   the viewer's client/storage, even if storage deletion fails.

Native credentials are not persisted to insecure web storage. Canceled OAuth is
not success. OAuth attempts have their own generation before a session epoch
exists: newer attempts, including canceled ones, invalidate older callbacks.
Credential writes/repairs use one serialized storage queue.

Terminal credential failures return 401; transient restore/network failures return
503 and preserve saved sessions/offline caches. A 403 means permission denial,
not expiry. Merely showing an error never signs out. `NetworkErrorView`'s explicit
Sign In action calls guarded sign-out and lets protected navigation show login;
pushing an auth route while credentials remain is blocked.

Transport-only native `FetchError`/cause prose is classified as a retryable network
failure, not shown with its internal request URL; HTTP status and session cancellation
remain authoritative.

Login accepts only a runtime-string handle parameter; remembered handles cannot
overwrite typing. Login/registration submissions have synchronous duplicate guards.
Registration completions must retain screen focus and session identity before OAuth.

## Queries, caches and writes

- Each session epoch creates a new QueryClient with its own book coordinator.
  There is no additional account-keyed coordinator map.
- Non-sensitive persisted queries are partitioned by API origin and DID; legacy
  shared caches are removed. Mutations and sync credentials are never persisted.
  Query GC is 24 hours.
- The root retry policy handles raw/enhanced network errors: no retries for
  401/403/404 or cancellation, bounded backoff for transient queries. Mutation
  retries are disabled: replaying PDS writes can duplicate records/reread history.
- Every mutation captures `createSessionFetch()` during render, **before** async
  `onMutate`, picker or cancellation work. Clearing a QueryClient does not cancel
  running mutations. Old-session requests abort/reject, never acquire a new cookie.
- Guarded sign-out and completion callbacks check the captured epoch, including
  account-deletion completion, so old work cannot sign out a new account.

`hooks/useBookhiveQuery.ts` is a compatibility re-export, not an implementation.
Implementations import domain modules directly, never the compatibility file.

| `hooks/queries/` module   | Owns                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `trackedBooks.ts`         | Detail, book writes/deletion and comments; queues in `utils/bookMutations.ts` |
| `discovery.ts`            | Search, featured discovery, genre directory and author/genre results          |
| `readers.ts`              | Profiles, follows, cursor feed and stats                                      |
| `catalogueLists.ts`       | Public AT-URI shelves, owner-keyed snapshots and ordering                     |
| `personalLibrary.ts`      | Private files/numeric shelves, upload and quota refresh                       |
| `sync.ts`                 | Documents, matching/dismissal and non-persisted credentials                   |
| `personalLibraryCache.ts` | Session-fenced invalidation and simple POST writes shared by file/sync hooks  |

### Canonical book state and drafts

`utils/bookMutations.ts` serializes updates/deletion per viewer/book and reconciles
the server's `UserBookView`. Application-level failures roll back even on HTTP 2xx.
Ownership writes use booleans; progress-only writes omit status so the server owns
lifecycle transitions. Clearing review/status/dates requires explicit empty values;
clearing status is not deleting the personal record. Settled writes invalidate
profile/My Books caches. Screen-local synchronous guards block overlapping writes
and deletion before hook state rerenders.

`useReadingProgressDraft.ts` stores all fields and canonical source identity together.
Reconcile on canonical progress changes, not unrelated updates; never move this into
an effect or mount the hook only when expanded. Identity uses an ordered tuple, not
wire-object property order. Manual percent `null` means automatic calculation;
empty text is intentional; page/chapter edits restore auto. `progressDraft.ts` owns
descriptors, parsing and presence-sensitive validation; `ReadingProgressCard.tsx`
renders without queries/writes. `useReviewDraft.ts` distinguishes untouched from
intentionally blank reviews. Failed optimistic saves restore submitted drafts,
including blanks. Progress summaries use saved values; collapsed reviews retain
their draft preview. Date confirmation awaits the write, retains selection/error
on failure and cannot be overwritten by canonical changes while open; reopening
uses the current date.

Comment/review keys use record URIs, not positions. Legacy fallbacks use stable
comment facts or reviewer DID (one review per reader/book). Comment edit/reply
guards fence cancellation, reopening and late feedback by mount/session identity.
`ReadingHistory` shows previous reads and viewer-scoped recent progress.

User `stars` is 1–10 and displays `/ 2`. Domain stats `averageRating` is already
five-star, but XRPC encodes fixed-point ×10 (`42` means `4.2`): decode `/ 10`.
Yearly stats never silently substitute all-time data; expose scope explicitly.

### Collections and pagination

Catalogue shelf patches preserve presence: empty descriptions/tags and false
ordering are intentional. Owner-keyed rollbacks restore only the affected shelf,
not unrelated concurrent edits; counts change only for items actually present.
Ordering uses item AT URIs. Private-file and sync-document rollbacks likewise
restore only their target/counts. Their shared optimistic boundary starts before
async cancellation, rejects same-target conflicts and defers refetch until all
targets settle. Simple library writes share `useLibraryWrite` (captured-session
POST, no retries, deferred invalidation); optimistic writes and linking retain
their domain-specific callbacks. File/progress linking refreshes tracked detail through the book
coordinator, retaining pending book edits until its queue drains.

Search debounces before selecting keys; filter changes reset pagination, pages
append, and any fetch blocks duplicate load-more. Failed pages retain loaded rows.
Feed refresh fetches a replacement first page without discarding cached pages;
only success resets its cursor. Display indexed activity time, not reading dates.

`hooks/useAuthorDirectory.ts` owns debounced language-keyed directory pages. The
server's top-500 directory count is not a whole-catalogue author count.
`useDebounce.ts` only delays strings: callers retain normalization/cancellation and
empty-query behavior (book search disabled, author directory enabled).
`DiscoveryBooksScreen`/`InfinitePaginationFooter` share presentation, not query
contracts: authors use server totals; genres use loaded unique count plus more.
Hidden genre queries stay disabled; directory access survives featured errors.
Genre counts remain all-language; author results are language-filtered.

## Ebooks, uploads and e-reader sync

`/library` manages files/private shelves; `/sync` explains external reader setup.
There is no in-app reader: authenticated downloads go to the OS share sheet.
File-backed sync documents appear in the matching grid card, unmatched ones in
triage, and matched/dismissed fileless ones in Also tracking. `utils/syncDocuments.ts`
owns partitioning/title fallback; `SyncDocumentSections` renders callbacks.

`api/personalLibraryTypes.ts` owns wire contracts. `api/uploadPersonalBook.ts`
owns captured-session XHR multipart transport to `/library/upload` and `UploadError`.
String server error prose is preserved; malformed success still refreshes the
captured viewer's library because the server may have committed.
`components/ebooks/useEbookUpload.ts` owns picker validation/quota/progress, while
the screen creates the mutation during render. Single-flight spans picker through
response; 100% byte transfer means processing, not success. Awaited reconciliation
survives navigation; UI callbacks remain mount/session fenced. Only picker-owned
cache copies are removed after settlement, never originals.

Every library page supplies `storage: { usedBytes, quotaBytes }`. Client checks are
advisory; the server enforces quota at insertion. Full-library actions explain why;
oversize selections fail before upload. Quota 413 (`QuotaExceeded`) displays server
prose and refetches the meter. Missing storage or `quotaBytes <= 0` means unlimited,
**not** full. Changing this wire shape requires an app release.

`SyncProgressPicker` requires selection of an actual returned sync document.
Filename/title, `hasFile` or a lone result cannot prove file→document identity.
Zero results permits an explicitly file-only link. File-link then progress-link
is two-step: retain partial success and retry only the unfinished step. Likewise,
failed create-then-add preserves the created shelf for membership retry. Await
continuations across navigation, check session before each step and fence prompt/
match generations so old work cannot close newer drafts.

Sync history is not proof of a live reader connection. Keep KOReader instructions
aligned with web, especially **Send document metadata**, which defaults off;
without it an unuploaded book's partial-MD5 hash cannot be matched. An uncertain
password rotation re-reads the current credential; never retry rotation itself.

## API and platform boundaries

`assets/images/icon.icon/` is the iOS Icon Composer source configured by `ios.icon`.
Keep its whole bundle intact; root formatting excludes its tool-owned JSON. Android
and web continue using their PNG assets, not this Apple-only bundle.

`api/` holds transport/wire contracts, not React state or caches. `queryFetch.ts`
decorates read errors, not a second client; `mutationResult.ts` validates PDS-write
success without coupling follows to book queues. Generated API types are type-only.
Native runtime imports may share pure `src/core`/`src/lib` modules, never Bun, DB,
filesystem or server-environment graphs. Validate boundary changes with both exports.
The byte-identical `utils/personalLibrary.ts` quota formatter is deliberate.

Account maintenance calls live-OAuth `buzz.bookhive.resyncAccount`/`deleteAccount`,
not service auth. Deletion requires exact displayed handle or DID confirmation;
always expose DID because only the server knows whether handle lookup failed.
It removes BookHive PDS records/indexes/files, not Bluesky accounts/posts. Partial
cross-system failure stays visible/retryable; sign out only after success.

CSV import uses existing `/import/{goodreads,storygraph,hardcover}` multipart/SSE
(or buffered native XHR), not a parallel mobile API. `useCsvImport.ts` coalesces
same-tick submissions, aborts on unmount/session replacement and refuses queued
work after unmount. Never retry a potentially accepted import automatically.
Only fresh picker copies directly in `Paths.cache/DocumentPicker/` are disposable;
streaming copies wait for settlement. A retry then requires reselecting the file.

## Presentation gotchas

- The root already reserves iOS top safe area. Screens use `useScreenTopInset`
  (zero on iOS); adding device top inset again doubles spacing. Tab bars use the
  bottom device inset. Native modals need their own safe-area provider.
- Fixed page headers use `ScreenHeader`/`BackNavigationHeader` outside scrolling
  content; section headings scroll. `HeaderAction` owns outlined header controls,
  labels and accessible targets. Keep the hairline and 16-point gap below headers,
  44-point controls, 52×64 rating choices and full text scaling/wrapping.
- Theme tokens live in `constants/Colors.ts`; `accentForeground` supplies readable
  text on accent treatments. Explicitly theme the native iOS date spinner.
  `ThemedTextInput` defaults placeholders to the app theme too; native defaults
  can be unreadable when the app's dark/light preference differs from iOS's.
- `ActionSheet` replaces many-button alerts (especially Android);
  both Cancel and backdrop dismissal expose named native button roles.
  The status modal's containing backdrop is non-accessible so iOS does not group
  its close control and radio options into one inaccessible native element.
  `TextPromptModal` replaces iOS-only `Alert.prompt`. Sheets scroll and expose
  selection state. `LanguagePicker` refreshes supported languages on open and
  distinguishes loading/error/empty, retaining All Languages and retry.
- `MotionPressable` owns interruptible press feedback; wait for Reduce Motion
  preference and stop on cleanup. Avoid long collection-wide entrance staggers.
- `BookCard`/`StarDisplay` share presentation; nested feed/profile actions remain
  separately accessible. `utils/catalogueCover.ts` owns public 300×500 proxy URLs;
  private `personalCoverSource` needs authenticated image headers, and tracked
  management keeps its distinct 300×450 transform.
- `src/core/genreEmoji.ts` is the shared mapping. Native image mapping in
  `components/discovery/genreEmojiImages.ts` uses bundled `assets/genre-emoji/`
  PNGs because iOS font glyphs can be missing. Keep mapping/fallback and asset
  provenance complete when adding emoji.

## Validation and delivery

Run commands in [README.md](README.md): Jest, typecheck, lint, dependency checks
and both native bundle exports. Exports do not validate native compilation/devices.
Jest 30 / jest-expo 58 use Testing Library 14 and `test-renderer` 1.3 for React 19.3,
not deprecated `react-test-renderer`. Render, hooks, events, act, rerender, unmount
and Router test helpers are awaited. `test/pressInFlight.ts` deliberately starts
callbacks without awaiting their network/picker promise so race tests can inspect
pending state; multiple targets dispatch in the same render before act flushes.
Queries inspect host output rather than removed composite `UNSAFE_*` APIs.
Router integration tests need `standard-navigation` transformed and Expo's dev
message socket/native-only FormData patch mapped across Bun peer instances
(otherwise CI reads a null bundle URL or patches Jest's incompatible FormData).

Theme preference uses AsyncStorage; credentials use SecureStore. Native modules
and SDK changes require new binaries, never OTA alone. Foreground OTA checks may
download, but activation waits for cold start or explicitly approved reload so drafts
survive. SDK 58 uses app/runtime version 1.4.0 to isolate SDK 57 development clients.
EAS CLI is pinned to 27.10.0 in scripts and eas.json. Native projects are generated
and ignored; preserve any existing native project before regenerating on SDK changes.
EAS profiles remain development/preview/production; bundle ID is
`buzz.bookhive.app`, scheme `bookhive://`. Release/version scripts never commit.
