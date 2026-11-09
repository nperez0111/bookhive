# Server/web lifecycle remediation

Follow-up to the November 8, 2026 implicit-state-machine audit. This is a worklist, not a claim
that every candidate needs a state-machine framework. Prefer explicit completion, ownership,
acknowledgement and cleanup boundaries. Mobile implementation is excluded; its separate handoff
is [mobile-state-machine-handoff.md](mobile-state-machine-handoff.md).

## First batch

- Book/buzz/shelf reconciliation: cursor-driven bounded traversal; incomplete scans must reject
  without pruning. Manual refresh reports failure; detached login work observes rejections.
- Follow synchronization: stage pages; atomically commit a complete full snapshot; do not advance
  freshness after incomplete scans. Incremental sync reactivates returned inactive rows. A durable
  per-user revision fences publication against intervening scans and acknowledged follow/unfollow.
- Account deletion: fail incomplete collection enumeration, transact local cleanup including
  reading progress history, and surface filesystem cleanup failures for retry.
- Comment deletion: require PDS acknowledgement before removing the local mirror, for both JSON
  and no-JS requests.
- Upload exception cleanup: directory creation and rename share quota-row rollback. Automatic
  sync links conditionally update only unresolved rows and bridge only returned winners.

Regression tests accompany these changes. Detailed invariants live in
`domain-rules-and-write-paths.md` and `e-reader-and-sync.md`.

## Next: data-loss and concurrent-write boundaries

1. **Implemented: durable deferred sync acknowledgement** (`data/syncWriteQueue.ts`,
   `services/syncWriteDrain.ts`): guarantees, legacy cutover and limitations live in
   `e-reader-and-sync.md`. Deferred canonical publication now checks the tracked URI/CID,
   queue revision and lease token transactionally, preserving newer progress and deleted rows.
   Remote commits remain uncancellable; this is not a global deletion/write barrier. A drain's
   100-entry cap is not a duration bound: a transport that never settles retains its lease.
   Releasing it at a caller-only deadline would permit overlapping live remote writes; recovery
   needs transport-enforced cancellation or process replacement, not an unsafe timer unlock.
2. **Implemented: sync association winners** (`data/syncBridge.ts`); see `e-reader-and-sync.md`.
   Optimistic progress now uses the canonical percentage-aware status inference, including 100%
   completion and preservation of terminal statuses. Still open: partial commits in manual linking
   that creates a new tracked book and the wider association/publication races below.
3. **Book write concurrency** (`services/getBook.ts`, `routes/lib.ts`): bulk overwrite and
   hiveBookUri backfill need fresh-record CAS/remerge, not stale whole-record updates. Existing
   interactive `bookRecordWrite` is the model. Advisory book locks need atomic ownership and
   token-qualified release. Do not sort CIDs as revisions. Remote commit/local publication needs
   repair semantics; save/delete need shared generation ownership to prevent recreation.
   Existing duplicate-record cleanup during re-sync also needs acknowledgement-aware deletion
   and must not re-upsert a just-deleted duplicate; its per-page grouping misses cross-page pairs.
4. **Upload publication/deletion** (`uploadPersonalBook.ts`, `personalLibrary.ts`, XRPC handlers):
   exception rollback is not crash recovery. Separate quota reservation from ready publication;
   reconcile interrupted uploads. Delete/re-upload at one deterministic hash path needs lifecycle
   ownership or generation paths/rename-to-trash plus retryable cleanup. Local multi-table
   mutations should transact, but SQLite cannot make PDS/filesystem effects atomic.
5. **Account deletion completion**: collection scans are now bounded/checked, but deletion is not
   a distributed quiescence barrier. Pending SQL/legacy sync work is now invalidated, but live
   ingestion/writes may recreate data. Coordinate tombstoning rather than claiming global atomicity.

## Then: user-visible asynchronous ownership

- Web `LibraryManager`: fence fetches by shelf/request generation and cursor; an obsolete response
  or finally block must not overwrite the current view/busy state. Replace whole-array rollback
  with entity-scoped queues/canonical refetch; serialize shelf membership changes.
- Web import table: check discriminated write results; serialize per-book mutations and unmatched
  resolution; preserve failed rows/errors. Namespace and validate persisted imports by viewer.
  Buffer events or establish hydration readiness before inline import events are emitted.
- **Implemented:** import SSE has one idempotent terminal cleanup owner for timeout/abort/error/complete/postMessage
  failure; cleanup must survive failed stream writes. Client EOF without terminal event is failure,
  not an indefinitely running import. The client stops reading after a terminal event so trailing
  events or transport errors cannot overwrite completion. Partial/per-book outcomes remain
  distinct from pipeline completion.
  Terminal errors get a bounded 1s output drain before Hono closes the response; worker/heartbeat
  cleanup stays immediate, and disconnect/deadline interrupts existing drains. Real Hono streaming
  regression tests cover callback-close ordering and underlying blocked-write settlement without
  reading the response. Upstream's per-event SSE acknowledgement bounds cross-thread backlog;
  heartbeat writes are singleflight too. Production Bun/Nitro disconnect propagation remains unverified.
- Search palette: agree on status-clearing contract with the server, prevent Enter on action
  buttons from triggering navigation, disable stale-query actions, reconcile status overrides.
- **Implemented:** book-detail optimistic state replays remaining ordered operations over the
  confirmed response; failure discards only the failed edit, preserving later pending paints.
- Failed lazy island imports should preserve navigation fallback and allow retry rather than
  permanently setting started. Rename dialogs should close only after confirmed save.

## Runtime, auth and auxiliary write paths

- **Implemented:** OpenObserve credited mailbox/HTTP payload bounds (1,024 entries/1 MiB, 64 KiB per line), oldest-item deadlines,
  consecutive-refusal reset, structured drop summaries and restart-only recovery.
  Stdout remains independent; shipping stays best effort, not durable. See `memory-and-runtime.md`.
- Coordinate bounded graceful shutdown; current immediate exit does not await ingestion,
  enrichment or telemetry. Verify Nitro signal/close integration rather than assuming hook order.
- **Implemented:** SQLite KV initialization uses an awaited per-driver singleflight promise;
  failed CREATE attempts reject waiters and permit retry. Explicit `tableCreated` bypass remains.
- **Implemented for `userBookFollowUp`:** per-URI dedupe, like semaphore capacity, survives the
  caller deadline until actual work settles. Still open: OG worker capacity and refresh locks.
  Do not release a live cross-process lock just because a caller deadline elapsed.
- Auth: bounded/invalidation-aware SessionClient cache; local refresh-lock lifetime accounting;
  server mobile-refresh endpoint should use guarded restore without changing its wire contract.
  Separate account-created from avatar/OAuth setup failure and login-success from hook failure.
- **Implemented:** cache singleflight is storage-scoped, accepts falsy hits, shares background and
  foreground work, and preserves fetched success on publication failure. The ineffective per-call
  token bucket option was removed; no second Goodreads limiter was added.
- Catalogue: queue missing enrichment; publish enrichment metadata/genres/identifiers coherently.
  Admin catalogue backfill needs run ownership and accurate written/failed counts.
- Follow/list writes: idempotent follow creation and duplicate-aware unfollow; CAS for concurrent
  list update/reorder; owner-qualified buzz lookup and honest exception/result contracts.
- Deployment: reject webhook HTTP failures, bound request time, and prevent obsolete mutable-tag
  publication/deployment. Cancellation alone cannot undo a tag already published; digest-based
  deployment/freshness checks need deployment-owner agreement.

## Preserve intentional designs

Do not add a WAF page-fetch breaker/gate, periodic PDS reconciliation, or a wholesale FSM-library
migration. Preserve centralized book lifecycle rules, viewer-isolated profile caching, ordered web
table writes, XRPC capability checks, native disclosure menus and primary-only enrichment draining.
Jetstream is deliberately a best-effort mirror: error acknowledgement needs a documented policy
and production-adapter coverage, not indiscriminate poison-event retries.

Lower-priority candidates include pointer cancellation/validation and clipboard feedback, token
rotation races, admin pagination guards, worker postMessage/close cleanup, OTA-independent server
observability tests and atomic publication of manually rebuilt vendor artifacts. Reassess each
against its actual reachability before increasing architectural complexity.
