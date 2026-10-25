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
- `@atcute/jetstream@2.2.0` uses the v2 `subscribeEvents` API with `kinds: ["commit"]` and the
  four BookHive/Popfeed collection filters. Flat commit payloads feed the existing mirror handler.
- `CursorStore.save` awaits the KV checkpoint with `cursorSaveInterval: 0` (every handled event).
  The library acknowledges a yielded event only when the consumer requests the next event, after
  the awaited handler succeeds. Returning the iterator after a handler failure skips that
  acknowledgement; shutdown during handling can conservatively replay the last handled event.
  Both outer retries and library-managed socket reconnects load KV `jetstream:v2:<host>:cursor`,
  never the socket's ahead-of-DB receive cursor. Delivery remains at-least-once; replayed sequence
  overlap is deduplicated by the client.
- V2 sequences are instance-specific, so the service is pinned to
  `wss://jetstream2.us-east.bsky.network`, not a randomized host pool. Changing the host starts
  fresh unless that host already has its own saved sequence.
- **Abort the subscription before returning its iterator.** `return()` alone cannot interrupt
  a pending async-generator `next()`; its AbortSignal closes the socket and settles that read.
  The lifecycle also explicitly cancels its pending read, with regression tests for quiet shutdown.
- Existing structured logs carry `reconnecting`, `connecting` (`service`, sequence `cursor`),
  stream advisories (`stream_info`) and connection/stream errors. Sequences are not timestamps;
  there is no `resume_lag_ms` calculation or new heartbeat protocol.
- `src/context.ts` restarts an exited/errored ingester worker after 3 seconds. Shutdown cancels
  that restart. Only the primary web process owns this worker.
- The parent checks once per minute for **12 hours without an ingestion event**, measured from
  worker spawn or the last forwarded commit outcome (including skipped/failed commits). Connection
  and backfill logs do not count. It logs `idle_ms`, terminates the worker and lets the same
  close/restart path replace it. Watching from the parent also covers a blocked worker event loop.
  Restart resumes the persisted cursor through normal Jetstream replay, not a PDS scan.

## V1 → V2 cutover: deliberately start at the live tip

The October 25 audit counted 4,281 `invalid_event` messages for missing `identity.handle`.
Jetstream permits that field to be omitted, but the legacy `@atcute/jetstream` schema required it
(upstream issue: https://github.com/mary-ext/atcute/issues/91). V2 uses its own lexicon schemas and
requests only commits; the temporary v1 Bun patch is removed. Envelope validation remains enabled,
and BookHive records still pass their separate book/buzz/list/item lexicon validation.

The old `jetstream:cursor` timestamp is left untouched and **never passed to the v2 client**.
With no saved v2 sequence, omit the wire cursor and start at the live tip, not historical replay.
The user explicitly accepted the possible one-time gap between the final v1 checkpoint and the
first v2 connection. There is no timestamp-to-sequence bootstrap or automatic history backfill.
After that, reconnects resume the saved v2 sequence. Settings → Book sync remains the repair path.

Do not try to reuse a timestamp with `subscribeEvents@2.2.0`: the server can translate it, but the
client also uses it as its local sequence floor and silently skips smaller real sequence numbers.
`src/bsky/jetstream.test.ts` also drives the installed v2 client over a local WebSocket,
checking the JSON subprotocol, filters, malformed-event rejection, separate record validation,
durable sequence replay and socket reconnects independently of the lifecycle unit tests.

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
