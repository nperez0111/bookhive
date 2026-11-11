# Mobile Feature Parity and Release Checks

The Expo app supports iOS and Android through shared server APIs. Automated tests
and bundle exports do not establish device verification. Current module/session/
draft/cache rules live in [app architecture](../../app/ARCHITECTURE.md); commands
and simulator startup live in [app README](../../app/README.md).

## Product and API boundaries

- Four tabs: Home, My Books, Discover and Profile. Secondary routes use the
  authenticated native root Stack, retaining the originating tab and back history;
  direct links use explicit fallback navigation.
- My Books manages tracked reading state and links to public shelves, stats,
  imports and Ebooks. Discover exposes search, genres/authors and community feed.
  Profile settings remain separate from public previews.
- Public AT-URI catalogue shelves and private numeric ebook shelves are separate.
  Downloads use authenticated OS sharing, not an in-app ebook reader.
- Book writes reconcile canonical lifecycle state; clearing status/review/dates is
  explicit. Half-star display divides user stars by two; XRPC fixed-point stats
  averages divide by ten. Yearly and all-time scopes remain explicit.
- `getBook.progressHistory` is viewer-scoped (at most 20 recent entries), omitted
  signed out; optional `shelves` contains public catalogue lists only.
- `getReadingStats.stats` remains yearly for older clients; additive `allTimeStats`
  and `showYearInBooks` expose the shared low-activity fallback.
- Account maintenance uses live-OAuth `buzz.bookhive.resyncAccount`/`deleteAccount`.
  Deletion removes BookHive PDS records, indexes and personal files, not a Bluesky
  account or unrelated posts. It is not cross-system atomic: failures must remain
  visible/retryable; external concurrent writes are not fenced.
- CSV imports reuse `/import/{goodreads,storygraph,hardcover}` multipart/SSE.
  Potentially accepted imports must not auto-retry.
- Author discovery uses the web's cached top-500 first-author directory (at least
  two books and positive total ratings), not an exhaustive export. Catalogue search
  seeds once, then `listSearchBooks` pages locally, bounded to 1,000 results and
  100 fully hydrated books per request rather than scraping every page.
- Web-only infrastructure/admin/SEO/marketing pages and pixel-identical web
  presentation are not native requirements. Admin database export is not an
  end-user full-account export.

## Release gates

- Run server tests/type-aware lint, mobile non-watch Jest/typecheck/lint, Expo
  dependency compatibility checks and both native bundle exports.
- Deploy additive history/statistics/discovery and account XRPC APIs before the
  client. Local validation does not deploy servers or publish an app.
- SDK 57 / RN 0.86 and native SecureStore/FileSystem/Sharing require new signed
  binaries for runtime 1.3.0; never ship this as OTA to an older runtime.
- Bun peer-context directories can trigger Expo Doctor's same-version native
  duplicate warning. Check autolinking/native builds before release; compatible
  dependencies and successful exports alone do not resolve it. Do not delete the
  shared lockfile or alter server React just to silence Doctor.
- On **both iOS and Android**, verify OAuth success/cancel/logout/account switching,
  offline restart, terminal expiry, transient refresh failure and secure-storage
  migration. Errors alone must not sign out; explicit Sign In must clear the old
  session and cannot navigate back into protected routes.
- Queue rapid status/progress/rating changes and deletion; force failures; check
  canonical rollback, intentionally blank drafts and account-switch isolation.
- Exercise cursor refresh/load-more/filter failures, shelf metadata/order/membership,
  and CSV success/partial failure/cancellation/navigation.
- Test quota rejection, picker-copy ownership, authenticated download/sharing,
  file/progress partial linking, uncertain password rotation and KOReader setup.
- Verify back gestures/direct links, keyboard-open search taps, large text, themes,
  Reduce Motion and modal safe areas on devices.
- Confirm destructive account wording/handle-or-DID rules using disposable accounts,
  never a real user's data. Compilation, device checks, signing and store submission
  remain separate from automated validation.
