# BookHive Mobile App — Architecture

Expo/React Native app (SDK 56, React 19.2, RN 0.85). Bun runtime, TypeScript strict mode, file-based routing via expo-router.

## Entry Points

| File                     | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `app/_layout.tsx`        | Root layout — wraps app in Auth, Theme, Query, and Navigation providers |
| `app/(auth)/_layout.tsx` | Auth stack for unauthenticated users                                    |
| `app/(tabs)/_layout.tsx` | 5-tab bottom navigation for authenticated users                         |

## Navigation

**Root** splits on `isAuthenticated`:

- **Auth Stack** → Login, Register
- **Tabs Stack** → Home, Feed, Explore, Search, Profile

### Bottom Tabs

| Tab     | File                  | Purpose                                                             |
| ------- | --------------------- | ------------------------------------------------------------------- |
| Home    | `(tabs)/index.tsx`    | Library overview — stats, shelves (Reading, Want to Read, Finished) |
| Feed    | `(tabs)/feed.tsx`     | Activity feed with Friends/All/Tracking tabs                        |
| Explore | `(tabs)/explore.tsx`  | Genre grid & top authors list                                       |
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

### Personal Library & E-Reader Sync

Two screens over the server's personal-library and KOSync features. `/library`
is "the files"; `/sync` is "how to connect a device". Both are reachable from
the Profile tab; `/library` also has a Home-tab quick action showing the file
count.

**`/library`** is a 2-column `FlatList` of `PersonalBookCard`s with a shelf-pill
header, an amber triage strip for synced documents that need a match, and an
"Also tracking" footer for documents with no uploaded file. Tapping a card opens
an `ActionSheet` (match/unmatch, shelves, delete) — there is no in-app reader, so
"manage this file" is the only meaningful primary action. Uploads go through
`expo-document-picker` → `POST /library/upload` as multipart, which lets React
Native stream the file off disk and drive a determinate progress bar from
`XMLHttpRequest.upload.onprogress`.

**`/sync`** shows a connection-status card (derived from whether any documents
have synced), the KOSync server URL, OPDS catalog URL, username and derived
password with reveal/copy/reset, and the six KOReader setup steps.

Sync documents are surfaced in three places by state: `hasFile` → folded into
the grid card that shares its content hash; unmatched → triage strip; matched or
dismissed → "Also tracking".

## State Management

### TanStack React Query (data fetching & caching)

- GC time: 24 hours
- Retry: up to 3 (queries), 2 (mutations), exponential backoff 1s–30s
- Cache persisted to AsyncStorage

### Query Hooks (`hooks/useBookhiveQuery.ts`)

| Hook                    | Purpose                               |
| ----------------------- | ------------------------------------- |
| `useProfile(did?)`      | User profile (books, stats, activity) |
| `useSearchBooks(query)` | Book search (300ms debounce)          |
| `useBookInfo(hiveId)`   | Book with comments, reviews, progress |
| `useFeed(tab, page)`    | Activity feed by tab                  |
| `useExplore()`          | Top genres & authors                  |
| `useUpdateBook()`       | Mutation: update status/rating/review |
| `useUpdateComment()`    | Mutation: add/edit comments           |
| `useDeleteBook()`       | Mutation: delete book                 |
| `useFollow()`           | Mutation: follow user                 |

#### Personal library & sync hooks

| Hook                                                       | Purpose                                        |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `usePersonalLibrary(shelfId?)`                             | Infinite query of uploaded books (24/page)     |
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

Exported types: `PersonalBook`, `PersonalShelf`, `SyncDoc`.

### Context Providers

| Provider        | File                | Persists to                | Purpose                      |
| --------------- | ------------------- | -------------------------- | ---------------------------- |
| `AuthProvider`  | `context/auth.tsx`  | AsyncStorage (`authState`) | DID, handle, session ID      |
| `ThemeProvider` | `context/theme.tsx` | AsyncStorage               | Light/dark/system preference |

## API Layer

**HTTP client**: `authFetch` (ofetch wrapper in `context/auth.tsx`)

- Base URL: `http://localhost:8080` (dev) / `https://bookhive.buzz` (prod)
- Auto-attaches session cookie (`sid=`)
- Sends app version, platform, platform version headers

### Endpoints

| Endpoint                                     | Method | Purpose                          |
| -------------------------------------------- | ------ | -------------------------------- |
| `/xrpc/buzz.bookhive.searchBooks?q=`         | GET    | Search books                     |
| `/xrpc/buzz.bookhive.getBook?id=`            | GET    | Book detail with comments        |
| `/xrpc/buzz.bookhive.getProfile?did=`        | GET    | User profile                     |
| `/xrpc/buzz.bookhive.getFeed?tab=&page=`     | GET    | Activity feed                    |
| `/xrpc/buzz.bookhive.getExplore`             | GET    | Genres & top authors             |
| `/api/update-book`                           | POST   | Update book status/rating/review |
| `/api/update-comment`                        | POST   | Add/edit comments                |
| `/api/delete-book`                           | POST   | Delete book                      |
| `/api/follow`                                | POST   | Follow user                      |
| `/xrpc/buzz.bookhive.getPersonalLibrary`     | GET    | Uploaded books (paginated)       |
| `/xrpc/buzz.bookhive.getPersonalBook`        | GET    | Single personal book detail      |
| `/xrpc/buzz.bookhive.uploadPersonalBook`     | POST   | Upload a personal book           |
| `/xrpc/buzz.bookhive.deletePersonalBook`     | POST   | Delete a personal book file      |
| `/xrpc/buzz.bookhive.linkPersonalBook`       | POST   | Link file to a hive book         |
| `/xrpc/buzz.bookhive.unlinkPersonalBook`     | POST   | Unlink file from a hive book     |
| `/xrpc/buzz.bookhive.*PersonalShelf`         | POST   | Shelf CRUD & membership          |
| `/library/upload`                            | POST   | Multipart ebook upload           |
| `/library/covers/:hash`                      | GET    | Cover extracted from a file      |
| `/library/shelves`                           | GET    | Shelves with book counts         |
| `/library/sync/documents`                    | GET    | Synced e-reader documents        |
| `/library/sync/{link,dismiss,rename,delete}` | POST   | Manage a synced document         |
| `/settings/sync/password`                    | GET    | Derived KOSync/OPDS password     |
| `/settings/sync/rotate`                      | POST   | Rotate the sync password         |
| `/mobile/login?handle=&redirect_uri=`        | GET    | OAuth login                      |
| `/mobile/refresh-token`                      | GET    | Refresh session                  |

## Authentication

1. User enters Bluesky handle on login screen
2. App opens browser → `/mobile/login?handle=X&redirect_uri=bookhive://oauth-callback`
3. Bluesky OAuth completes → redirects to `bookhive://oauth-callback?did=X&handle=X&sid=X`
4. Deep link handler stores `{ did, handle, sid }` in AuthContext + AsyncStorage
5. On app launch: `/mobile/refresh-token` refreshes session
6. Logout clears AsyncStorage, redirects to login

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

| File                                          | Purpose                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `utils/htmlToText.tsx`                        | Parse HTML → React Native Text with nested tags                                  |
| `utils/calculatePercentFromProgressValues.ts` | Progress percentage calculation                                                  |
| `utils/networkErrorHandler.ts`                | Error classification (network/timeout/server/auth/404) & retry logic             |
| `utils/navigation.ts`                         | Navigation helpers                                                               |
| `utils/personalLibrary.ts`                    | Cover source resolution (incl. the `sid` cookie), size/author/percent formatting |

## Key Dependencies

| Package                                   | Version   | Purpose                  |
| ----------------------------------------- | --------- | ------------------------ |
| expo                                      | ^56.0.0   | Framework                |
| expo-router                               | ~56.2.11  | File-based routing       |
| @tanstack/react-query                     | ^5.100.10 | Data fetching & caching  |
| react-native                              | 0.85.3    | Runtime                  |
| react-native-reanimated                   | 4.3.1     | Animations               |
| ofetch                                    | 1.5.1     | HTTP client              |
| @react-native-async-storage/async-storage | 2.2.0     | Persistent storage       |
| date-fns                                  | ^4.1.0    | Date formatting          |
| @react-native-community/netinfo           | 12.0.1    | Network detection        |
| expo-document-picker                      | ~56.0.4   | Picking ebook files      |
| expo-clipboard                            | ~56.0.4   | Copying sync credentials |

## Build & Deploy

| Command                     | Purpose                         |
| --------------------------- | ------------------------------- |
| `bun run start`             | Expo dev server                 |
| `bun run ios`               | iOS simulator                   |
| `bun run android`           | Android emulator                |
| `bun run test`              | Jest tests                      |
| `bun run ios:build`         | EAS build for iOS               |
| `bun run ios:submit`        | Submit to App Store             |
| `bun run update:production` | OTA update (production channel) |
| `bun run update:staging`    | OTA update (staging channel)    |

**EAS Profiles** (`eas.json`):

- `development` — dev client, internal distribution
- `preview` — staging channel, internal distribution
- `production` — production channel, auto-increment version

**App Config** (`app.json`):

- Bundle ID: `buzz.bookhive.app`
- Version: 1.0.5
- Deep link scheme: `bookhive://`
- New Architecture enabled
