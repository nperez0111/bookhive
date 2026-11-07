# Mobile Feature Parity Audit

This audit compares the server-rendered web application with the Expo application
in `app/`. Both iOS and Android use that application; a feature is not considered
verified on a native device merely because its TypeScript or JavaScript tests pass.

## Scope and acceptance

- Prefer native implementations using existing shared server APIs, rather than
  silently opening authenticated web pages without the app's session.
- Keep catalogue book lists separate from uploaded-ebook shelves.
- Preserve the server's canonical book lifecycle, rating scales, pagination, and
  authentication rules. Failed writes must not look successful.
- Update dependencies within the supported Expo compatibility matrix. Native
  dependency changes require a new native build, not just an OTA update.
- Document any remaining gaps and manual device checks explicitly.

## Validation baseline

Before implementation, `bun test src server` passed: 1,042 tests across 88 files.
The starting working tree was clean.

## Inventory and priorities

The three independent initial audits covered live web routes/shared server APIs,
native routes/hooks and dependency/build/test configuration. Existing native
features were counted before adding anything: catalogue list CRUD, language
preferences, abandoned/owned states, chapter progress, yearly stats, ebook
uploads/private shelves, catalogue matching and KOReader/OPDS setup already existed.

| Area                | Web baseline                                                              | Initial native gap or defect                                                                                 | Upgrade scope                                                                                                              |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Sessions            | Cookie-scoped viewer data and terminal-vs-transient OAuth errors          | Logout retained the global session; persisted queries crossed accounts; temporary refresh failure logged out | Session-bound requests, restoring state, secure credentials, viewer-isolated caches and non-destructive transient failures |
| Tracked books       | Unified `/my-books` search, statuses, ownership and sorts                 | Separate status screens only; invalid status route crashed                                                   | Native My Books workspace; preserve status entry points                                                                    |
| Book lifecycle      | Serialized canonical `UserBookView` writes, explicit progress transitions | Numeric owned values, ignored canonical response, stale optimistic rollback, unsafe write retries            | Typed boolean ownership, per-book queues/deletion, response validation and cache reconciliation                            |
| Reviews/ratings     | Editable/clearable reviews, half stars, saved dates and history           | Edit did nothing, clearing review/status was unreliable, rating gesture closure stale                        | Functional edit/clear controls, accessible half stars, saved-date controls, reread and progress history                    |
| Activity            | Indexed-time cursor feed and actor bursts                                 | Refresh retained old cursor; errors hidden                                                                   | Infinite cursor queries, fresh refresh, burst rendering and visible retry                                                  |
| Discovery           | Debounced search and paginated genre/author results                       | Raw search key; load-more replaced pages                                                                     | Debounce/cancellation, accumulated pages, reset on filter changes                                                          |
| Catalogue shelves   | Public AT URI lists with descriptions, ordered items and tags             | CRUD existed but ordering/tags incomplete; incorrect rollback snapshots                                      | Ordered lists, metadata, reorder controls and robust errors                                                                |
| Personal ebooks     | Query/sort/cursor, private shelves, quota and file downloads              | Files/shelves already supported; no search/sort/download workflow                                            | Native filters and authenticated download/share; keep quota and cover behavior                                             |
| Reader sync         | Credentials, OPDS/KOSync setup and document triage                        | Already broadly present                                                                                      | Preserve matching/rename/dismiss/delete; improve failures and wording                                                      |
| Profiles/stats      | Follow/unfollow, public lists and yearly/all-time fallback                | No unfollow; incorrect star scales; low-activity stats misleading                                            | Unfollow, corrected ratings, public shelves and shared stats fallback                                                      |
| Imports             | Goodreads, StoryGraph and Hardcover CSV with progress/errors              | Not exposed natively                                                                                         | Native provider/file selection and streamed import results                                                                 |
| Account maintenance | Re-sync cached AT Protocol data and delete BookHive account               | Not exposed natively                                                                                         | Native confirmation flows backed by live-OAuth XRPC procedures                                                             |
| Settings            | Language, theme, legal/support links                                      | Android multi-button language alert; dead legal links                                                        | Searchable language picker and working links                                                                               |
| Delivery            | Server tests and reproducible build                                       | Mobile Jest failed before running, missing lint configuration, auto-commit version script                    | Supported Expo upgrade, deterministic checks/CI and non-committing release tooling                                         |

### Domain boundaries

- **My Books** tracks public AT Protocol `user_book` records and reading state.
- **Catalogue shelves** are public `book_list` records keyed by AT URI; order and
  membership sync to the PDS.
- **Ebook shelves** are private numeric `personal_shelf` records holding uploaded
  files. They are not public lists and must never leak into catalogue shelf views.
- Account deletion removes BookHive's records (including BookHive book/buzz/list
  records on the PDS), indexes and personal files. It does **not** delete the
  user's Bluesky account or unrelated Bluesky posts.
- Reading history is viewer-scoped. The additive `getBook.progressHistory` field
  contains at most 20 newest entries; signed-out responses omit it. The optional
  `shelves` field contains public catalogue lists only, never private ebook shelves.
- `getReadingStats.stats` remains yearly for old clients; `allTimeStats` and
  `showYearInBooks` expose the existing shared low-activity fallback without
  changing that contract. User stars are stored on a ten-point scale and displayed
  with `/ 2`. The shared domain `averageRating` is five-star, but XRPC transports
  it as fixed-point ×10 (`42 = 4.2 stars`); both native stats scopes decode `/ 10`.

Native startup keeps `ThemeProvider` above the root's first `useColorScheme`
consumer; the root smoke test uses both real implementations. Refresh credential
classification recognizes the OAuth SDK's terminal error types (including missing
sessions), not just message fragments; connectivity failures and timeouts remain
transient and do not destroy the session.

For an expired session encountered while the app is running, the error screen's
explicit Sign In action clears the live/stored session and lets protected navigation
show login. Merely displaying an error does not sign out the viewer. A regression
test restores a real authenticated context under the root protected routes, preserves
it through a transient error, then verifies explicit sign-out reaches login and
cannot bounce back into the authenticated tabs.

## Release validation checklist

- Run server tests/type-aware lint and mobile typecheck/lint/non-watch Jest.
- Run Expo dependency compatibility checks and export native bundles.
- Deploy the server's additive history/statistics/discovery and account XRPC
  APIs before distributing the new client. This working-tree change does not
  deploy the server or publish an app release.
- On **both iOS and Android**, exercise login/cancel/logout/account switch,
  temporary offline restart, expired sessions and secure-storage migration.
- Queue rapid book/progress/rating changes and deletion; force a failed write;
  check canonical rollback and account-switch isolation.
- Exercise cursor refresh/load-more/filter changes, ordered shelves, CSV import
  with success/partial failure/cancellation, quota rejection and file sharing.
- Confirm destructive account wording and confirmation; do not test deletion
  against a real user's account.
- Account removal spans the PDS, SQLite and files, so it is not a cross-system
  atomic transaction. Failures must surface as failures and allow retry; concurrent
  external writes are not fenced by this operation.
- Build new native binaries for the Expo/native-module upgrade. Do not publish
  this change as an OTA update to an older native runtime.

## Explicit non-goals and remaining surfaces

Neither app gains an in-app ebook reader in this upgrade: downloads are handed
to the OS share/open workflow. Web-only infrastructure/admin/debug/SEO/marketing
pages are not missing mobile product features. There is no existing end-user
full-account export on the web; the admin database export is not such a feature.
The web genre and author directories are now available natively, including name
search and author-directory pagination. `listAuthors` uses the same cached top-500
first-author directory as the web (at least two books and positive total ratings),
not an unbounded author export. Language filters reset native pagination. Web-only
presentation variants are not reproduced pixel-for-pixel.

Catalogue discovery seeds search once, then uses `listSearchBooks` to page beyond
the original 20-result seed without scraping once per page. It is bounded to
1,000 discoverable results and 100 fully hydrated books per request, rather than
being an exhaustive catalogue export.

### Dependency and delivery decisions

The app moves from SDK 56 / RN 0.85 to **Expo 57.0.31 / React Native 0.86.3**,
with React and its test renderer both at 19.2.3. This is a supported compatibility
upgrade, not an attempt to install every package's latest major independently.
SecureStore, FileSystem and Sharing are native additions. The app/runtime version
is 1.3.0; new signed binaries and device verification are required.

Mobile CI now runs deterministic Jest, TypeScript, ESLint and both native bundle
exports. Release tooling pins EAS and no longer stages or commits version changes.
Expo Doctor reports **20/21** checks passing: its remaining duplicate-native-module
check detects same-version packages in Bun peer-context directories. Compatibility
checks and bundle exports pass, but neither proves that a signed native build is
safe; this warning remains a release gate, not a suppressed check.

## Completed automated validation

On the integrated working tree:

| Check                                           | Result                                            |
| ----------------------------------------------- | ------------------------------------------------- |
| `bun test --parallel src server`                | 1,091 passing tests across 94 files               |
| Mobile `bun run test:run`                       | 174 passing tests across 33 suites; normal exit   |
| Root type-aware lint; mobile typecheck and lint | Pass; mobile lint has no warnings                 |
| `bunx expo install --check`                     | Dependencies compatible                           |
| `bun install --frozen-lockfile`                 | Pass, no dependency changes                       |
| Mobile `bun run export:check`                   | Both iOS and Android Hermes bundles exported      |
| Root `bun run build`                            | Production client/server and worker bundles built |
| `git diff --check`                              | Pass                                              |

These are automated checks, not signed native compilation, device UI testing,
production deployment or store submission. The native build/device checklist and
the Expo Doctor warning above remain outstanding release gates. No commits or
publishing were performed.

Regression coverage includes real root theme/protected navigation, terminal versus
transient sessions, rating scales, progress drafts, list metadata clearing and
rollback, pagination failures, and account-switch cancellation. Shared presentation
does not merge query-specific counts, pagination or session guards.

The simplification pass reuses book rows, star displays, pagination footers and
numeric progress-field definitions instead of maintaining parallel renderers.
Status constants come from the pure shared module. Search keeps its bounded read
layer without a single-use service wrapper; XRPC request context exposes typed
response capabilities. Session clients own their write coordinator and query retry
policy, while stale-request and callback fences remain intact.

### Transport correction

Account maintenance uses general `buzz.bookhive.resyncAccount` and
`buzz.bookhive.deleteAccount` XRPC procedures with lexicon validation, generated
types and live-OAuth auth (`pdsWrite`). The temporary `/mobile/account/*` router
was removed, not retained as a second implementation. The native hooks preserve
session-bound requests and guarded cache/sign-out callbacks. Existing browser/native
CSV imports remain multipart/SSE at `/import/{provider}`; OAuth browser handoffs
remain transport-specific. Neither exception introduces a new mobile product API.

Account regressions cover service-token rejection, confirmation/session cleanup,
native XRPC paths, unsuccessful responses and conditional DID confirmation. The
shared resync core's existing early return on refused PDS listing is unchanged;
it remains a separate reliability issue.
