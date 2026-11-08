# Mobile lifecycle audit — redesign handoff

Assessment recorded November 8, 2026. **No mobile code was changed for this audit/fix pass.**
The user has a mobile redesign in progress: coordinate with its owner before implementing
anything here. File/line references describe the audited revision and will drift during that work.
These are static-code findings, not claims that every interleaving has occurred in production.
Prefer explicit operation ownership and existing query/store patterns over a blanket FSM library.

## 1. Session identity and private-cache isolation (highest priority)

`app/context/auth.tsx` (approximately lines 51–150): module-level auth, provider state,
AsyncStorage and the query persistence buster can disagree. Sign-out removes stored credentials
and updates React state but does not clear the module-level SID consumed by `authFetch`.
Sign-in/sign-out do not consistently advance the buster. The singleton QueryClient in
`app/app/_layout.tsx` survives account changes, while private query keys often omit the viewer:
profile, book state, personal library/shelves, sync documents and the indefinitely cached password.

- Make one session transition own memory, storage, query cancellation/cache and navigation.
- Clear in-memory credentials synchronously even if storage removal fails.
- Fence old requests/callbacks with a session generation; old work must not publish into a new user.
- Isolate private caches by viewer/session or replace/reset the client and persisted cache.
- Distinguish terminal authentication failure (401) from permission denial (403). Current
  `networkErrorHandler`/`NetworkErrorView` navigation can leave old credentials/cache intact.
- Cache eviction is not server-side revocation; preserve the intended server session contract.

Regression: A signs in → private data/password fetched → logout → B signs in. No A SID, data,
pending mutation or persisted response may be visible or sent afterward, including storage failure.

## 2. Bootstrap, OAuth and registration

`app/context/auth.tsx` (74–145), login/register screens and auth layouts:

- Bootstrap lacks an explicit restoring state. The module value can be populated before refresh
  finishes, leaving a provider with stale signed-in state after a failed refresh. Early navigation
  can redirect to login before restoration is known.
- Offline/transient refresh errors currently discard credentials. Separate signed-out,
  restoring, signed-in and temporarily unavailable; validate stored/callback shapes instead of
  coercing missing values with `String(undefined)`. Include AsyncStorage reads in error handling.
- OAuth cancellation resolves like success; callers fade/navigate anyway. Both provider and
  screens own navigation. Return a success/cancel/failure outcome and pick one navigation owner.
- A created account followed by OAuth cancellation/failure needs “continue login”, not another
  account-creation attempt. Fence old OAuth completion against a newer attempt/logout.

Regression: provider mounting during refresh; offline restore; malformed credentials/callback;
OAuth cancel; account-created-but-login-incomplete; obsolete callback after logout.

## 3. Ordered mutations and drafts

`app/hooks/useBookHiveQuery.ts` and `app/app/book/[id].tsx`:

- Book mutations use independent whole-cache optimistic snapshots. An earlier failed operation
  can erase a later edit; delete can overlap save; settlement refetch can overwrite queued work.
  Use per-book confirmed state + ordered pending operations and reconcile canonical responses.
  The web `libraryTableStore` is a reference, not code to import into the native bundle blindly.
- List query keys include DID, but some rollback snapshots use only `[userLists]` while updates
  touch matching queries. Snapshot/restore exact key-data pairs, with operation ownership.
- Shelf/list/personal-library whole-array rollback has the same overlap problem. Deletion must
  not decrement totals for every cached page/shelf when the item was absent.
- Retried non-idempotent comment/list creation can duplicate records after a lost response.
  Disable blind retries or establish a stable operation identity/server idempotency contract.
- Progress draft effects depend on the entire book response and can reset dirty edits during
  unrelated refetches. Track dirty fields and the draft generation. The payload already includes
  `updatedAt`, making a later empty-object check ineffective.
- Review fallback `draft || server` cannot represent deliberate empty text; completion can clear
  typing begun while a save was pending. Distinguish pristine from empty and fence completions.
- `CreateListModal` can reset a draft when an inline object changes; cleared description sent as
  undefined means omission, not clearing. Agree on clearing semantics with the server first.

Regression: two edits with first failure; delete during save; exact-key rollback; dirty draft
during refetch; typing during save; lost-response create; explicit clearing where supported.

## 4. Book and comment interaction lifetimes

- Native `StarRating` creates PanResponder once, capturing initial disabled/callback/rating;
  absolute `pageX` and relative layout coordinates are mixed. Use current references, matching
  coordinates, release/cancel cleanup and confirmed-state rollback; handle rejected writes.
- Date actions close before asynchronous confirmation succeeds; validate before mutation and
  preserve the draft/error on failure.
- Book deletion confirmation is conditional on optimistically changed book fields and may
  disappear mid-request; owned/progress-only books also need an intentional deletion capability.
- `CommentsSection` lacks complete pending guards. Some edit/reply controls silently do nothing
  without parent URI/CID; array-index keys can attach draft state to another comment. Use stable
  URI identity and expose only actionable capabilities, with visible failures.
- `app/app/books/[status].tsx` dereferences an invalid status configuration before its guard;
  validate route input before hook dependencies/render logic.
- Book back-navigation pushes a new status route and can lose originating profile context.

## 5. Personal-library upload, linking and overlays

`app/app/library.tsx`, upload/query hooks and sync UI:

- File picking can launch more than once and picker rejection is not consistently handled.
  Model picking → uploading → server processing → complete/error; 100% bytes is not completion.
  Add session fencing/cancellation ownership and cleanup of copied cache files. Preserve streaming
  upload, disabled automatic retries and authoritative server quota responses.
- Linking the file can succeed before linking sync progress fails. The flow assumes the sync
  document ID equals the content hash, but filename-identified documents may have another hash.
  Carry the actual document identity or use one server operation; report retryable partial success.
  Inspect server `data/personalBooks.ts`, `/library` link route and XRPC link procedure together.
- Independently nullable overlay targets let an old completion close a newly opened prompt.
  Use a tagged target/operation generation; apply completion only to its original target.
- Create-shelf then add-book can partially succeed; retain the shelf and explain/retry the add.
  Rename/add/remove/unlink failures should not disappear into console logging.
- Historical sync documents do not prove an active reader connection. Render last-sync,
  unknown and request-error states instead of treating document count as connected/disconnected.
- Password rotation correctly disables retries, but a lost response leaves an indefinitely cached
  old password. Invalidate/re-read on an uncertain outcome rather than retrying rotation blindly.

No mobile reader/download/conversion-resume state machine was found: actual reading/conversion
belongs to the external reader/server. Do not invent durable offline editing/download promises.

## 6. Query, search and pagination ownership

- Search debounce only controls enabled while the query key/function use raw input. Use the
  same settled value in key, request and enabled; clearing must not send an old/empty query.
- Feed manually combines pages alongside cursor query caching. Refresh can refetch the previous
  cursor after resetting state, or reuse a stale first-page cache. Let one owner manage pages,
  refresh and synchronous in-flight pagination guards. Preserve server indexedAt ordering/cursors.
- Genre/author “Load more” replaces rather than appends; filter/route changes can retain offsets.
  Either accumulate pages or label ordinary pagination honestly and reset on identity changes.
- Several screens conflate failed/stale/empty query data; auxiliary errors vanish, and profile
  refresh omits lists. Display stale data + refresh failure separately from genuine empty success.
- Offline error UI offers pull-to-refresh where no scroll/retry action exists. Establish native
  connectivity/foreground integration and honest retry behavior, not unsupported offline queues.
- `AddToList` disables only the currently selected row despite one global pending target. Prevent
  overlapping adds or track each operation; obsolete completions must not close a newer sheet.

Regression: debounce and clear; feed refresh after page two; duplicate end-reached callbacks;
filter switch with page pending; cache success followed by refresh failure; old sheet completion.

## 7. App-wide presentation/update lifetimes

- Automatic and manual OTA checks have separate ownership. Foreground checks do not enforce the
  claimed elapsed interval; automatic reload can interrupt drafts/uploads. Share single-flight
  ownership, timestamp policy and safe defer/prompt behavior.
- Late language/theme/login-preference hydration can overwrite a choice made during startup.
  Gate hydration or retain local edits. Theme enum validation/loading behavior is otherwise useful.
- Root navigation reads system color scheme above the custom ThemeProvider, so navigation can
  disagree with the selected preference. Splash readiness covers fonts but not all theme loading;
  include a font-error recovery path.
- Root `NetworkErrorBoundary` enters an absorbing error state without reset/retry. Provide an
  explicit recovery transition instead of requiring process restart.
- Minor polish: initial online `NetworkStatusIndicator` opacity with showAlways; timer and gesture
  cleanup. Ordinary ActionSheet/TextPrompt/DatePicker/FadeInImage state does not justify a rewrite.

## Test baseline and adoption order

The audit attempted native Jest with `./node_modules/.bin/jest --runInBand --watchAll=false
--passWithNoTests` from `app/`. Both existing suites failed before executing tests because the
React Native Jest preset imported `@react-native/js-polyfills/error-guard` as unhandled ESM
(“Cannot use import statement outside a module”). This was not repaired; coordinate with the
redesign tooling owner. Existing header/text tests do not exercise these lifecycle boundaries.

Recommended order: session isolation → bootstrap/OAuth → ordered mutation/draft ownership →
upload/link partial outcomes → pagination/query ownership → update and presentation recovery.
Keep regression tests above as acceptance criteria even if the redesign replaces the current files.
