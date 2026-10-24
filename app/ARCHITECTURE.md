# BookHive Mobile App — Architecture

Expo/React Native app (SDK 57, React 19.2, RN 0.86). Bun workspace, TypeScript strict mode, file-based routing via expo-router. See `../docs/notes/mobile-feature-parity.md` for the web/native audit and release checklist.

## Entry Points

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `app/_layout.tsx`        | Root layout — Theme wraps the themed content, Auth, Query and Navigation providers |
| `app/(auth)/_layout.tsx` | Auth stack for unauthenticated users                                               |
| `app/(tabs)/_layout.tsx` | 5-tab bottom navigation for authenticated users                                    |

## Navigation

**Root** waits for `isRestoring`, then splits on `isAuthenticated`:

- **Auth Stack** → Login, Register
- **Tabs Stack** → Home, Feed, Explore, Search, Profile

### Bottom Tabs

| Tab     | File                  | Purpose                                                             |
| ------- | --------------------- | ------------------------------------------------------------------- |
| Home    | `(tabs)/index.tsx`    | Library overview — stats, shelves (Reading, Want to Read, Finished) |
| Feed    | `(tabs)/feed.tsx`     | Activity feed with Friends/All/Tracking tabs                        |
| Explore | `(tabs)/explore.tsx`  | Featured genres/authors and searchable genre/author directories     |
| Search  | `(tabs)/search.tsx`   | Book search with debounce & collapsible header                      |
| Profile | `(tabs)/settings.tsx` | User profile, theme toggle, sign out                                |

### Detail Routes (hidden from tab bar)

| Route                       | File                                  | Purpose                                                                      |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `/book/[id]`                | `(tabs)/book/[id].tsx`                | Book detail — cover, description, status, rating, review, progress, comments |
| `/books/[status]`           | `(tabs)/books/[status].tsx`           | Shelf filtered by status with sort options                                   |
| `/profile/[did]`            | `(tabs)/profile/[did].tsx`            | Other user's profile with follow button                                      |
| `/profile/[did]/stats`      | `(tabs)/profile/[did]/stats.tsx`      | Reading statistics by year                                                   |
| `/explore/genres/[genre]`   | `(tabs)/explore/genres/[genre].tsx`   | Books by genre, sortable & paginated                                         |
| `/explore/authors/[author]` | `(tabs)/explore/authors/[author].tsx` | Books by author, sortable & paginated                                        |
| `/library`                  | `(tabs)/library/index.tsx`            | Personal library — uploads, shelves, synced-document triage                  |
| `/sync`                     | `(tabs)/sync/index.tsx`               | E-Reader sync — KOSync/OPDS credentials and KOReader setup                   |
| `/my-books`                 | `(tabs)/my-books.tsx`                 | Search/filter/sort tracked books, list/grid views and owned toggles          |
| `/lists`                    | `(tabs)/lists/index.tsx`              | Own or another user's public catalogue shelves                               |
| `/lists/[uri]`              | `(tabs)/lists/[uri].tsx`              | Public shelf items; owner metadata, tags and ordering controls               |
| `/import`                   | `(tabs)/import.tsx`                   | Goodreads, StoryGraph and Hardcover CSV import with progress/results         |
| `/account`                  | `(tabs)/account.tsx`                  | Re-sync records and explicitly confirm BookHive account deletion             |

My Books (tracked AT Protocol records), catalogue shelves (public AT URIs), and
ebook shelves (private numeric IDs) are three distinct domains, not interchangeable
views of one library. Home's My Books action and the Profile tab expose the new
management screens. The language picker is searchable and scrollable on both
platforms; never use a many-button Android alert for this.

Account deletion requires an exactly typed displayed handle or the signed-in DID
before opening its destructive confirmation alert. Always expose the DID option,
even with a cached profile or stored handle: only the server knows whether its
profile lookup is unavailable. The server accepts the DID only in that case;
otherwise it requires the exact current handle. Pending mutations disable submission.

### Personal Library & E-Reader Sync

Two screens over the server's personal-library and KOSync features. `/library`
is "the files"; `/sync` is "how to connect a device". Both are reachable from
the Profile tab; `/library` also has a Home-tab quick action showing the file
count.

**`/library`** is a 2-column `FlatList` of `PersonalBookCard`s with a shelf-pill
header, an amber triage strip for synced documents that need a match, and an
"Also tracking" footer for documents with no uploaded file. Tapping a card opens
an `ActionSheet` (download/share, match/unmatch, shelves, delete). There is no
in-app reader: the OS share sheet hands the authenticated download to another
app. Search/sort and shelf changes reset the cursor. Uploads go through
`expo-document-picker` → `POST /library/upload` as multipart, which lets React
Native stream the file off disk and drive a determinate progress bar from
`XMLHttpRequest.upload.onprogress`.

**Storage quota.** Every `getPersonalLibrary` page carries a `storage`
`{usedBytes, quotaBytes}`, so `StorageMeter` stays current off the queries the
screen already runs — there is no separate usage request and nothing extra to
invalidate. Three guards hang off it, in increasing order of how much they cost
the user to hit:

- The upload button dims and explains itself when the library is full, rather
  than being `disabled` — a dead control in a header answers no questions.
- A picked file larger than the remaining quota is refused before a byte goes
  over the wire. This is a _hint_, not the rule: `storage` is as old as the last
  fetch, and the server evaluates the quota inside the INSERT.
- A 413 that gets through arrives as an `UploadError` with
  `code: "QuotaExceeded"`, whose message is the server's own prose (rendered
  verbatim) and which triggers a library refetch, because a rejection means the
  meter was showing room that wasn't there.

`quotaBytes <= 0` means the deployment has quotas switched off, and so does an
older server that sends no `storage` at all; both must read as "no ceiling",
never as "full", or every upload on such a server would be blocked client-side.

**`/sync`** shows a connection-status card (derived from whether any documents
have synced), the KOSync server URL, OPDS catalog URL, username and derived
password with reveal/copy/reset, and the seven KOReader setup steps. One of those
steps is load-bearing rather than cosmetic: KOReader's "Send document metadata"
toggle defaults to **off**, and with it off a sync request identifies the book by
a single partial-MD5 hash, so a book the user never uploaded here has nothing to
match against. The web setup instructions say the same thing — keep the two lists
in step.

Sync documents are surfaced in three places by state: `hasFile` → folded into
the grid card that shares its content hash; unmatched → triage strip; matched or
dismissed → "Also tracking".

## State Management

### TanStack React Query (data fetching & caching)

- GC time: 24 hours
- The root query retry policy handles raw fetch errors and enhanced network errors:
  401/403/404 and cancellations never retry; transient failures use bounded backoff.
  Hooks inherit this policy; mutation retries are disabled by default
  because replaying a PDS write can create duplicates or rotate reread history twice.
- A new QueryClient is created for each session epoch. Persisted non-sensitive
  queries are partitioned by API origin and DID; mutations and sync credentials
  are never persisted. Legacy shared cache is removed.
- Each epoch-scoped client owns one book-mutation coordinator; there is no second
  account-keyed coordinator map. Guarded sign-out owns cancellation/cache teardown,
  including after account deletion, so a delayed completion cannot sign out a new
  session.
- Every mutation captures `createSessionFetch()` during render/before any async
  `onMutate`: clearing a QueryClient does not cancel a running mutation. Requests
  bound to an old session abort/reject rather than use a later account's cookie.

### Query Hooks (`hooks/useBookhiveQuery.ts`)

| Hook                    | Purpose                               |
| ----------------------- | ------------------------------------- |
| `useProfile(did?)`      | User profile (books, stats, activity) |
| `useSearchBooks(query)` | Book search (300ms debounce)          |
| `useBookInfo(hiveId)`   | Book with comments, reviews, progress |
| `useFeed(tab)`          | Infinite cursor activity feed by tab  |
| `useExplore()`          | Top genres & authors                  |
| `useUpdateBook()`       | Mutation: update status/rating/review |
| `useUpdateComment()`    | Mutation: add/edit comments           |
| `useDeleteBook()`       | Mutation: delete book                 |
| `useFollow()`           | Mutation: follow user                 |
| `useUnfollow()`         | Mutation: unfollow user               |

Book updates/deletes are serialized per viewer/book and reconcile the canonical
`UserBookView` from `/api/update-book`; application-level failures must roll back,
not masquerade as successful HTTP responses. Owned inputs are boolean (the read
model may contain numeric SQLite booleans). Progress-only writes omit status so
the server owns lifecycle transitions. Review/status/date clearing uses explicit
empty values. `BookActionCard` keeps date-clear controls; `ReadingHistory` shows
previous reads and the newest viewer-scoped progress entries. Book detail also
links to public catalogue shelves. User `stars` in My Books/profile/detail divide
the stored 1–10 value by two. Stats' domain `averageRating` is already 0–5, but
XRPC encodes it as a fixed-point integer ×10 (`42` means `4.2`); native yearly and
all-time stats divide that wire value by ten, not by two.

Catalogue list mutations use exact owner-keyed snapshots, owner-only ordering by
item AT URI, optional tags, explicit description clearing and visible failures.
Search/discovery debounce before selecting query keys, append pages, and reset on
filter changes. Feed refresh starts with a fresh cursor; render activity time from
the indexed-time contract, not the user's backdated reading dates.

`hooks/useAuthorDirectory.ts` separately owns debounced name search, language-keyed
infinite pages and retries for the web-equivalent top-500 author directory. Its
`listAuthors` response supplies the next offset and total after filtering; the UI
does not infer a whole-catalogue author count from that bounded directory.

`hooks/useDebounce.ts` owns only the delayed string value shared by book search
and the author directory. Normalization, cancellation, query keys and empty-query
behavior remain in the callers (empty book search is disabled; empty author search
loads the directory).

Author/genre detail routes share `components/DiscoveryBooksScreen.tsx`, a
presentation-only results grid with loading/error/retry and load-more controls.
Each route retains its own query hook, language reset key and count contract:
server total for authors, loaded unique count plus a more indicator for genres.
`components/InfinitePaginationFooter.tsx` shares next-page/retry presentation across
that grid, search, discovery directories and the ebook library. Callers retain
visibility/reset rules and loaded cards; errors retry the failed page, and any
fetch blocks another load-more.

Catalogue list query/cache shapes use the generated `getList`/`getUserLists`
types. Metadata edits build one presence-sensitive patch for detail and owner-list
caches, preserving explicit empty description/tags and false ordering. Session
fences and exact-key rollback snapshots remain in the mutation hooks.

Book detail holds progress inputs and their canonical source key in one local
draft object. Canonical progress changes replace all draft fields together;
unrelated updates preserve them. Manual percent `null` means auto-calculation,
whereas an empty string remains intentional; editing pages/chapters restores auto.
Page/chapter inputs share typed descriptors and one change handler, while manual
percentage stays separate. My Books, status shelves and profiles reuse `BookCard`
rows; ownership controls remain outside navigation. Cards/comments use the shared
`StarDisplay` rather than separate rating renderers.

#### Personal library & sync hooks

| Hook                                                       | Purpose                                        |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `usePersonalLibrary(shelfId?)`                             | Infinite query of uploaded books (24/page)     |
| `storageFromLibrary(data)`                                 | Storage usage out of a library result (helper) |
| `usePersonalShelves()`                                     | Shelves with book counts                       |
| `useSyncDocuments()`                                       | Synced e-reader documents                      |
| `useSyncPassword()` / `useRotateSyncPassword()`            | Derived KOSync/OPDS password, and rotating it  |
| `useUploadPersonalBook()`                                  | Multipart upload with progress (XHR)           |
| `useDeletePersonalBook()`                                  | Delete a file (optimistic)                     |
| `useLinkPersonalBook()` / `useUnlinkPersonalBook()`        | Match a file to a catalog entry                |
| `useCreate/Update/DeletePersonalShelf()`                   | Shelf CRUD                                     |
| `useAddToPersonalShelf()` / `useRemoveFromPersonalShelf()` | Shelf membership                               |
| `useLinkSyncDocument()` / `useDismissSyncDocument()`       | Match a document, or mark it "not on BookHive" |
| `useRenameSyncDocument()` / `useDeleteSyncDocument()`      | Rename / forget a document (both optimistic)   |

Exported types: `PersonalBook`, `PersonalShelf`, `PersonalStorage`, `SyncDoc`, and
`UploadError` (a real class — it carries the server's `code`, so a caller can
tell a quota rejection from a dropped connection and act on it).

### Context Providers

| Provider        | File                | Persists to                      | Purpose                                               |
| --------------- | ------------------- | -------------------------------- | ----------------------------------------------------- |
| `AuthProvider`  | `context/auth.tsx`  | Native SecureStore (`authState`) | DID, handle, session ID; migrates legacy AsyncStorage |
| `ThemeProvider` | `context/theme.tsx` | AsyncStorage                     | Light/dark/system preference                          |

The root `ThemeProvider` must wrap `RootLayoutContent` before its first
`useColorScheme()` call. A provider returned by that same consumer cannot supply
its context. The root-layout startup test deliberately uses the real theme hook
and provider so this cannot be hidden by screen-level mocks.

## API Layer

**HTTP client**: `authFetch` (ofetch wrapper in `context/auth.tsx`)

- Base URL: `EXPO_PUBLIC_API_URL`, defaulting to `https://bookhive.buzz` even in dev.
  Set an explicit reachable development origin; localhost on a phone is the phone.
- Auto-attaches session cookie (`sid=`)
- Sends app version, platform, platform version headers

### Endpoints

| Endpoint                                                                                      | Method | Purpose                                             |
| --------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| `/xrpc/buzz.bookhive.searchBooks?q=`                                                          | GET    | Search books                                        |
| `/xrpc/buzz.bookhive.getBook?id=`                                                             | GET    | Book detail with comments                           |
| `/xrpc/buzz.bookhive.getProfile?did=`                                                         | GET    | User profile                                        |
| `/xrpc/buzz.bookhive.getFeed?tab=&cursor=`                                                    | GET    | Cursor activity feed                                |
| `/xrpc/buzz.bookhive.getExplore`                                                              | GET    | Genres & top authors                                |
| `/xrpc/buzz.bookhive.listAuthors`                                                             | GET    | Paged language-aware web author directory (top 500) |
| `/api/update-book`                                                                            | POST   | Update book status/rating/review                    |
| `/api/update-comment`                                                                         | POST   | Add/edit comments                                   |
| `/books/:hiveId`                                                                              | DELETE | Delete book                                         |
| `/api/follow`                                                                                 | POST   | Follow user                                         |
| `/api/unfollow`                                                                               | POST   | Unfollow user                                       |
| `/xrpc/buzz.bookhive.{getUserLists,getList}`                                                  | GET    | Public catalogue shelves                            |
| `/xrpc/buzz.bookhive.{createList,updateList,deleteList,addToList,removeFromList,reorderList}` | POST   | Catalogue shelf writes                              |
| `/xrpc/buzz.bookhive.getReadingStats`                                                         | GET    | Yearly stats plus additive all-time fallback        |
| `/xrpc/buzz.bookhive.getPersonalLibrary`                                                      | GET    | Uploaded books (paginated)                          |
| `/xrpc/buzz.bookhive.getPersonalBook`                                                         | GET    | Single personal book detail                         |
| `/xrpc/buzz.bookhive.uploadPersonalBook`                                                      | POST   | Upload a personal book                              |
| `/xrpc/buzz.bookhive.deletePersonalBook`                                                      | POST   | Delete a personal book file                         |
| `/xrpc/buzz.bookhive.linkPersonalBook`                                                        | POST   | Link file to a hive book                            |
| `/xrpc/buzz.bookhive.unlinkPersonalBook`                                                      | POST   | Unlink file from a hive book                        |
| `/xrpc/buzz.bookhive.*PersonalShelf`                                                          | POST   | Shelf CRUD & membership                             |
| `/library/upload`                                                                             | POST   | Multipart ebook upload                              |
| `/library/covers/:hash`                                                                       | GET    | Cover extracted from a file                         |
| `/library/shelves`                                                                            | GET    | Shelves with book counts                            |
| `/library/sync/documents`                                                                     | GET    | Synced e-reader documents                           |
| `/library/sync/{link,dismiss,rename,delete}`                                                  | POST   | Manage a synced document                            |
| `/settings/sync/password`                                                                     | GET    | Derived KOSync/OPDS password                        |
| `/settings/sync/rotate`                                                                       | POST   | Rotate the sync password                            |
| `/mobile/login?handle=&redirect_uri=`                                                         | GET    | OAuth login                                         |
| `/mobile/refresh-token`                                                                       | GET    | Refresh session                                     |
| `/xrpc/buzz.bookhive.resyncAccount`                                                           | POST   | Re-fetch BookHive records; strict JSON `{}`         |
| `/xrpc/buzz.bookhive.deleteAccount`                                                           | POST   | Delete BookHive data; strict JSON `{confirmHandle}` |
| `/import/{goodreads,storygraph,hardcover}`                                                    | POST   | Multipart `export` CSV, streamed progress/results   |

## Authentication

1. User enters Bluesky handle on login screen
2. App opens browser → `/mobile/login?handle=X&redirect_uri=bookhive://oauth-callback`
3. Bluesky OAuth completes → redirects to `bookhive://oauth-callback?did=X&handle=X&sid=X`
4. Validated callback stores `{ did, handle, sid }` in AuthContext + native SecureStore
5. On app launch: `/mobile/refresh-token` refreshes session
6. Logout immediately clears the global session, aborts old requests, removes the
   viewer's query client and stored credentials, then redirects to login.

Canceled OAuth is not a successful sign-in. Refresh returns terminal 401 only for
invalid credentials, including the SDK's missing/deleted-session errors; temporary
restore failures and timeouts return 503 and preserve the saved session/offline
cache. App launch exposes an explicit restoring state. On web,
native session credentials are not persisted into insecure browser storage.

The error screen's explicit **Sign In** action calls `signOut()` and lets the root
protected navigation present login; pushing an auth route while credentials still
exist is blocked. Displaying an error alone never clears the session, including
transient server/network failures. The navigation regression uses the real root
guards and AuthProvider with a restored account, and checks that stale navigation
cannot send the signed-out viewer back into tabs. Jest transforms the router's
ESM `standard-navigation` dependency for this integration test.

Account deletion removes BookHive PDS records as well as local indexes/personal
files; it does **not** delete a Bluesky account or unrelated posts. The native
adapter shares the web deletion core and revokes/destroys the OAuth session only
after cleanup succeeds. CSV import reuses the existing server pipeline and limit,
supports incremental SSE or buffered native XHR responses, and reports partial
failures without retrying a potentially accepted import.

## Components

### Themed Primitives

| Component         | Variants                                       |
| ----------------- | ---------------------------------------------- |
| `ThemedView`      | default, card, surface                         |
| `ThemedText`      | title, heading, label, body, caption, overline |
| `ThemedButton`    | primary, secondary, outline, ghost × sm/md/lg  |
| `ThemedTextInput` | Themed text input wrapper                      |
| `ThemedCard`      | elevated, outlined                             |
| `GradientView`    | primary, secondary, warm, cool                 |

### Book Components

| Component                 | Purpose                         |
| ------------------------- | ------------------------------- |
| `BookCard`                | Book with cover, title, authors |
| `BookGridItem`            | Grid variant of book card       |
| `BookActionCard`          | Status/rating action card       |
| `StarRating`              | Interactive 1–5 star selector   |
| `CommentsSection`         | Comments/reviews list           |
| `StatusSelectionModal`    | Modal for changing book status  |
| `DeleteConfirmationModal` | Delete confirmation dialog      |
| `DatePickerModal`         | Date picker for reading dates   |
| `PersonalBookCard`        | Grid card for an uploaded file  |
| `StorageMeter`            | Library storage used vs. quota  |
| `BookSearchModal`         | Catalog picker for matching     |

### Layout & Navigation

| Component              | Purpose                          |
| ---------------------- | -------------------------------- |
| `BackNavigationHeader` | Header with back button          |
| `ParallaxScrollView`   | Scroll view with parallax header |
| `SectionHeader`        | Section title with icon          |
| `ListItem`             | Settings list item with chevron  |
| `Divider`              | Visual divider                   |
| `ActionSheet`          | Themed bottom sheet of actions   |
| `TextPromptModal`      | Single-field prompt sheet        |
| `ProgressBar`          | Animated 0–1 progress bar        |

`ActionSheet` is the house menu — prefer it over `Alert.alert` with more than
two buttons, which reads as a warning and stacks badly on Android.
`TextPromptModal` exists because `Alert.prompt` is iOS-only.

### Animation

| Component          | Purpose                       |
| ------------------ | ----------------------------- |
| `FadeInImage`      | Image with fade-in            |
| `AnimatedListItem` | Staggered list item animation |
| `AnimatedTabIcon`  | Tab icon with scale on focus  |
| `HapticTab`        | Tab with haptic feedback      |

### Error Handling

| Component                | Purpose                      |
| ------------------------ | ---------------------------- |
| `NetworkStatusIndicator` | Banner showing connectivity  |
| `NetworkErrorView`       | Full-screen error with retry |
| `NetworkErrorBoundary`   | Error boundary wrapper       |
| `QueryErrorHandler`      | TanStack Query error display |

## Styling

- **Color system**: Light & dark palettes in `constants/Colors.ts` (amber/gold primary)
- **Typography**: SpaceMono-Regular custom font, variant system via ThemedText
- **Spacing**: 16px base unit
- **Shadows**: Platform-specific (iOS shadow, Android elevation)
- **Theme**: `useColorScheme()` and `useThemeColor()` hooks, system preference detection

## Utilities

Native runtime imports may share platform-neutral modules from `src/core` and
`src/lib` (for example, book lifecycle rules and status constants). Keep those
imports free of Bun, database, filesystem and server-environment dependencies;
generated API contracts are type-only imports. Verify boundary changes with both
native bundle exports. The byte-identical `formatBytes` copy in
`utils/personalLibrary.ts` is intentionally retained, not a Metro limitation.

| File                                          | Purpose                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `utils/htmlToText.tsx`                        | Parse HTML → React Native Text with nested tags                                  |
| `utils/calculatePercentFromProgressValues.ts` | Progress percentage calculation                                                  |
| `utils/networkErrorHandler.ts`                | Error classification (network/timeout/server/auth/404) & retry logic             |
| `utils/navigation.ts`                         | Navigation helpers                                                               |
| `utils/personalLibrary.ts`                    | Cover source resolution (incl. the `sid` cookie), size/author/percent formatting |

## Key Dependencies

| Package                                   | Version          | Purpose                            |
| ----------------------------------------- | ---------------- | ---------------------------------- |
| expo                                      | 57.0.31          | Framework                          |
| expo-router                               | 57.0.29          | File-based routing                 |
| @tanstack/react-query                     | ^5.100.10        | Data fetching & caching            |
| react-native                              | 0.86.3           | Runtime                            |
| react-native-reanimated                   | 4.5.1            | Animations                         |
| ofetch                                    | 1.5.1            | HTTP client                        |
| @react-native-async-storage/async-storage | 2.2.0            | Persistent storage                 |
| date-fns                                  | ^4.1.0           | Date formatting                    |
| @react-native-community/netinfo           | 12.0.1           | Network detection                  |
| expo-document-picker                      | 57.0.3           | Picking ebook/CSV files            |
| expo-clipboard                            | 57.0.2           | Copying sync credentials           |
| expo-secure-store                         | 57.0.4           | Native credential storage          |
| expo-file-system / expo-sharing           | 57.0.7 / 57.0.24 | Authenticated ebook download/share |

## Build & Deploy

| Command                              | Purpose                         |
| ------------------------------------ | ------------------------------- |
| `bun run start`                      | Expo dev server                 |
| `bun run ios`                        | iOS simulator                   |
| `bun run android`                    | Android emulator                |
| `bun run test`                       | Jest tests                      |
| `bun run test:run`                   | Non-watch CI Jest tests         |
| `bun run typecheck` / `bun run lint` | Native TypeScript / ESLint      |
| `bun run export:check`               | Export iOS and Android bundles  |
| `bun run ios:build`                  | EAS build for iOS               |
| `bun run ios:submit`                 | Submit to App Store             |
| `bun run android:build`              | EAS build for Android           |
| `bun run android:submit`             | Submit to Google Play           |
| `bun run update:production`          | OTA update (production channel) |
| `bun run update:staging`             | OTA update (staging channel)    |

**EAS Profiles** (`eas.json`):

- `development` — dev client, internal distribution
- `preview` — staging channel, internal distribution
- `production` — production channel, auto-increment version

**App Config** (`app.json`):

- Bundle ID: `buzz.bookhive.app`
- Version: 1.3.0 (native runtime changes require new binaries)
- Deep link scheme: `bookhive://`
- New Architecture enabled

SDK 57 is the conservative supported upgrade, including the newer Hermes/RN
patch line rather than the SDK 56 baseline. Exact compatible versions live in
`package.json`/`bun.lock`; use `expo install --check` before changing native deps.
Release commands pin EAS CLI. Version bumps never stage or commit changes.
Foreground OTA checks may download an update but do not automatically reload and
discard unsaved edits; activation waits for the next cold start (or an explicit
user-approved reload). See `README.md` for device/build commands.
