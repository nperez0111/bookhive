# Ingestion Recovery & Discovery Backfill

## What failed and the recovery tradeoff

Issue #242 reported external-client changes that appeared in Jetstream but not in BookHive.
Historical `server_logs` show a global ingestion gap from **2026-10-12 07:41:31 UTC** until the
worker started again on **2026-10-19 02:47:08 UTC**, while HTTP traffic continued throughout.
The reported October 15 changes fell inside that gap. The exact socket/worker failure wasn't
established; current PDS and mirror records already agreed after manual refreshes and later updates.

Jetstream replay is finite, so reconnecting with an old cursor cannot guarantee recovery of every
missed change. Restart failed workers and replay the saved cursor; use Settings → Book sync for
exceptional missed-history recovery. Do not routinely rescan known users or infer a broken
connection from short periods of silence. A 12-hour absence of ingestion events triggers worker
replacement and cursor replay. This is a best-effort mirror, not a durable event-processing system.

## Stream lifecycle (`src/bsky/jetstream.ts`)

- Errors and unexpected iterator completion reconnect after 3 seconds. Socket reconnects are also
  handled by the subscription library. Short quiet periods on the filtered stream are left alone.
- Checkpoints are awaited, in order, after commit handling. Reconnection reads the saved KV
  `jetstream:cursor`, never the subscription's receive cursor (which can be ahead of DB writes).
- **Returning the installed EventIterator closes its socket but leaves a pending `next()`
  unresolved.** Explicitly cancel the pending read on close; `return()` alone leaves shutdown
  stuck forever. Tests deliberately reproduce that behavior.
- Existing structured logs carry `reconnecting`, `connecting` (`cursor`, `resume_lag_ms`), and
  connection/stream errors. Cursor age is context, not a failure threshold; no separate health
  endpoint or heartbeat protocol is introduced.
- `src/context.ts` restarts an exited/errored ingester worker after 3 seconds. Shutdown cancels
  that restart. Only the primary web process owns this worker.
- The parent checks once per minute for **12 hours without an ingestion event**, measured from
  worker spawn or the last forwarded commit outcome (including skipped/failed commits). Connection
  and backfill logs do not count. It logs `idle_ms`, terminates the worker and lets the same
  close/restart path replace it. Watching from the parent also covers a blocked worker event loop.
  Restart resumes the persisted cursor through normal Jetstream replay, not a PDS scan.

## One-time discovery backfill (`src/bsky/ingester.ts`)

The first successfully mirrored book event for a reader in a worker process requests discovery
backfill, capped at **3 concurrent repositories**. Readers with a `backfill_done:<did>` completion
marker are skipped permanently. There is no startup scan,
daily schedule or periodic retry. A failed backfill is eligible again in a later worker process;
manual sync remains available for known readers needing repair.

`backfillUserRepo` reads public PDS `listRecords` for books, buzzes, lists and list items,
100 records per page, with 15-second request timeouts and a 500-page ceiling per collection.
It inserts missing books, buzzes and list items without overwriting existing rows. Lists use
`bookListUpsertSet` to mirror metadata and ranked `itemOrder`, including pre-migration lists.
There is no snapshot/CID guard against concurrent list writes; manual sync can repair a race.
Non-2xx responses, malformed pagination and page-limit exhaustion log `backfill_error` and
**do not set the completion marker**. Successful scans log `backfill_complete`.

This path **never writes to the PDS**. Do not reuse `refetchBooks`: it also deletes duplicate PDS
records and patches their catalog references. Discovery backfill deliberately does not
infer deletions from absent records, discover unknown accounts, catalog missing books, or queue
every failed Jetstream event. Books still require an existing catalog row, as the original
backfill did. The 12-hour watchdog is deliberately conservative; it does not guarantee recovery
of changes older than Jetstream's retained history. Manual sync handles that exceptional case.
