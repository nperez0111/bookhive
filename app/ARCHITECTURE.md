# BookHive Mobile App — Architecture

Expo/React Native app (SDK 54, React 19, RN 0.81). Bun runtime, TypeScript strict mode, file-based routing via expo-router.

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

| Endpoint                                 | Method | Purpose                          |
| ---------------------------------------- | ------ | -------------------------------- |
| `/xrpc/buzz.bookhive.searchBooks?q=`     | GET    | Search books                     |
| `/xrpc/buzz.bookhive.getBook?id=`        | GET    | Book detail with comments        |
| `/xrpc/buzz.bookhive.getProfile?did=`    | GET    | User profile                     |
| `/xrpc/buzz.bookhive.getFeed?tab=&page=` | GET    | Activity feed                    |
| `/xrpc/buzz.bookhive.getExplore`         | GET    | Genres & top authors             |
| `/api/update-book`                       | POST   | Update book status/rating/review |
| `/api/update-comment`                    | POST   | Add/edit comments                |
| `/api/delete-book`                       | POST   | Delete book                      |
| `/api/follow`                            | POST   | Follow user                      |
| `/mobile/login?handle=&redirect_uri=`    | GET    | OAuth login                      |
| `/mobile/refresh-token`                  | GET    | Refresh session                  |

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

### Layout & Navigation

| Component              | Purpose                          |
| ---------------------- | -------------------------------- |
| `BackNavigationHeader` | Header with back button          |
| `ParallaxScrollView`   | Scroll view with parallax header |
| `SectionHeader`        | Section title with icon          |
| `ListItem`             | Settings list item with chevron  |
| `Divider`              | Visual divider                   |

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

| File                                          | Purpose                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `utils/htmlToText.tsx`                        | Parse HTML → React Native Text with nested tags                      |
| `utils/calculatePercentFromProgressValues.ts` | Progress percentage calculation                                      |
| `utils/networkErrorHandler.ts`                | Error classification (network/timeout/server/auth/404) & retry logic |
| `utils/navigation.ts`                         | Navigation helpers                                                   |

## Key Dependencies

| Package                                   | Version  | Purpose                 |
| ----------------------------------------- | -------- | ----------------------- |
| expo                                      | ~54.0.0  | Framework               |
| expo-router                               | ~6.0.23  | File-based routing      |
| @tanstack/react-query                     | ^5.90.10 | Data fetching & caching |
| react-native-reanimated                   | ~4.1.5   | Animations              |
| ofetch                                    | ^1.4.1   | HTTP client             |
| @react-native-async-storage/async-storage | 2.2.0    | Persistent storage      |
| date-fns                                  | ^3.6.0   | Date formatting         |
| @react-native-community/netinfo           | 11.4.1   | Network detection       |

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
