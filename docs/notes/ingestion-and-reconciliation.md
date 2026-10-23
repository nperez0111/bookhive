# Ingestion & PDS Reconciliation

## Why reconnecting alone is not enough

Issue #242 reported external-client changes that appeared in Jetstream but not in BookHive.
Historical `server_logs` show a global ingestion gap from **2026-10-12 07:41:31 UTC** until the
worker started again on **2026-10-19 02:47:08 UTC**, while HTTP traffic continued throughout.
The reported October 15 changes fell inside that gap. The exact socket/worker failure wasn't
established; current PDS and mirror records already agreed after manual refreshes and later updates.

Jetstream replay is finite, so reconnecting with an old cursor cannot guarantee recovery of every
missed change. Keep both mechanisms below. This is intentionally a best-effort mirror, not a
durable event-processing system.

## Stream lifecycle (`src/bsky/jetstream.ts`)

- After **15 minutes without a received event**, close the iterator and reconnect; errors and
  unexpected iterator completion also reconnect after 3 seconds. Identity/account events count
  as received traffic even though only commits are mirrored.
- Checkpoints are awaited, in order, after commit handling. Reconnection reads the saved KV
  `jetstream:cursor`, never the subscription's receive cursor (which can be ahead of DB writes).
- **Returning the installed EventIterator closes its socket but leaves a pending `next()`
  unresolved.** Explicitly cancel the pending read on close; `return()` alone leaves the watchdog
  and shutdown stuck forever. Tests deliberately reproduce that behavior.
- Existing structured logs carry `stalled`, `reconnecting`, `connecting` (`resume_lag_ms`),
  `behind` and `caught_up` (`lag_ms`). Behind means event age exceeds 15 minutes; no separate
  health endpoint or heartbeat protocol is introduced.
- `src/context.ts` restarts an exited/errored ingester worker after 3 seconds. Shutdown cancels
  that restart. Only the primary web process owns this worker.

## Bounded periodic reconciliation (`src/bsky/ingester.ts`)

The worker scans known accounts (`user_book.userDid`) in sorted batches of **20 per minute**,
with **3 concurrent repositories** and no overlapping batch. Successful scans are skipped for
24 hours using `reconciled_at:<did>`. Newly discovered readers also enter this same limiter.
This targets daily repair at current scale; it is not a hard daily deadline for unlimited users
or slow PDSes. Failed accounts remain eligible on the next sweep. The old permanent
`backfill_done:` flags are deliberately ignored.

`reconcileUserRepo` reads public PDS `listRecords` for books, buzzes, lists and list items,
100 records per page, with 15-second request timeouts and a 500-page ceiling per collection.
It updates changed CIDs and inserts missing rows. Non-2xx responses, malformed pagination and
page-limit exhaustion log `reconcile_error` and **do not advance the successful-scan timestamp**.
Successful scans log `reconcile_complete`, repaired-row count and duration.

Before fetching a collection, snapshot its local URI/CID pairs. Apply each page in a short
`BEGIN IMMEDIATE` transaction, only where the current CID still matches that snapshot (including
absence). This prevents a PDS response from overwriting an update, resurrecting a deletion, or
overwriting a new row received while that request was in flight. Book/buzz writes use the shared
`userBookUpsertSet`/`buzzUpsertSet`/`bookListUpsertSet` (including Popfeed `itemOrder`); unchanged
records are skipped, and progress-only repairs must
not re-date feed activity.
One exception to CID skipping: migration 029 leaves existing list `itemOrder` null, so fetch
and fill a missing order even when the list CID already matches the PDS. The same concurrent-CID
guard applies; subsequent unchanged scans skip the repaired list normally.

This path **never writes to the PDS**. Do not reuse `refetchBooks`: it also deletes duplicate PDS
records and patches their catalog references. Background reconciliation deliberately does not
infer deletions from absent records, discover unknown accounts, catalog missing books, or queue
every failed Jetstream event. Books still require an existing catalog row, as the original
backfill did. Daily repair complements replay; it doesn't replace normal Jetstream ingestion.
