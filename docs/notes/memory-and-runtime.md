# Memory pressure and runtime history

On November 3, 2026, the kernel recorded two cgroup OOM kills (00:44 and 04:42 UTC) while
Docker reported zero container restarts: the supervisor survived and restarted individual Bun
workers. The 6 GiB cgroup limit was reached; the killed workers each held about 2.3 GiB anonymous
RSS. `memory.events.oom_kill`, kernel logs, and worker exits are stronger evidence than container
restart count. `likely_oom` on a SIGKILL alone remains a heuristic.

OpenObserve retained request history after Docker's three 10 MB log files rotated away.
Both OOM windows coincided with roughly 550 completed profile requests and thousands of requests
taking over 10 seconds (maximum about 173s). These are completion/ingestion timestamps, not
arrival or concurrency measurements. They correlate workload pressure with the OOMs; they do
not establish a particular heap leak, retained object, or profile-handler allocation as the cause.

On November 6, a second incident had a different scope: the kernel recorded **global OOMs**
around 00:26–00:29 UTC, killing processes in other containers and all three BookHive workers.
BookHive's cgroup showed `oom_kill=3` but `oom=0` / `max=0`: a victim counter does not prove
the container hit its own limit. The host has about 7.6 GiB RAM, versus BookHive's 6 GiB limit;
other containers compete for the same host memory. This does not establish which workload
initiated the pressure, and no host/container limits were changed during investigation.

## Local instrumentation

- Response timings distinguish `response_prepare` (downstream route work, JSX serialization and
  anonymous-cache handling), `response_etag` (response-clone consumption and digest), and
  `response_compress_setup` (installing the compression stream, not body delivery or compression
  CPU). The historical `compress` timer encloses all downstream work and must not be interpreted
  as isolated compression time. `resources.response_stages` counts requests currently preparing
  responses or awaiting ETags in each application's runtime sample; stalled event loops can delay
  those samples. Excluded download/SSE routes retain their existing streaming exclusions.
- `src/metrics.ts` exports the worker-labelled `bookhive_requests_in_flight` gauge, maintained
  in the wide-event middleware's `try/finally`, including requests excluded from completion logs.
  It measures Hono execution, not streaming response consumption or pre-Hono failures.
- Once a minute, `runtime_sample` goes through the ordinary logger to stdout **and OpenObserve**:
  worker/build/uptime, RSS, JS heap, external and ArrayBuffer bytes, active requests, maximum
  **sampled** active requests, maximum event-loop lag and actual sample window. Sampling runs
  every 5s; brief peaks can be missed, and a stalled/killed worker cannot report on time.
- Independently, `server/cluster.ts` samples procfs every 15s and logs `cluster_memory` once a
  minute, with each worker's PID/RSS/anonymous memory plus cgroup v2 current/limit/peak/swap,
  OOM/limit-event counters and anonymous/file/kernel memory. Both samples and worker exits also
  include host-visible `/proc/meminfo` total/available memory and swap (kB), plus memory PSI
  `some`/`full` averages (percent) and cumulative stall totals (microseconds). These describe the
  host, not BookHive's allocation; isolated procfs layouts may expose different visibility.
  Compare counter increases and PID changes; peak/counters are cumulative for
  the cgroup, not per-sample events. Unsupported layouts produce missing fields, not invented zeros.
  An unlimited cgroup limit is recorded explicitly as `memory.max: "max"`, not as a missing field.
  **Supervisor logs go only to Docker stdout/stderr**, not the application OpenObserve shipper;
  collect/archive them before rotation when investigating an incident.

After deployment, correlate `runtime_sample` heap/external/active requests and lag by worker
with `cluster_memory` anonymous memory and cgroup pressure, then inspect slow request paths.
Watch `page_cache_error` on request events and `page_cache_sweep` phase durations separately.
Missing samples during a gap are not proof of low memory or no requests. This adds diagnostic
history, not admission control, a heap dump, or a proven fix for the OOM mechanism.

## SQLite mappings are not a resident-memory budget

`DB_MMAP_SIZE` permits SQLite to map the first N bytes of the database; it does not preload
those bytes, select the hottest pages, or cap resident memory. Pages beyond the mapping still
use ordinary reads. Linux can share physical file-cache pages between workers, including pages
accessed without mmap, so summing workers' file-backed RSS overcounts physical usage. The cgroup
still accounts for file cache, which is reclaimable but not free under pressure. Writes, SQLite's
private page caches, query intermediates and hydrated JavaScript rows allocate separately.

`DB_CACHE_KB` is a suggested private SQLite cache budget per main-database connection, not a
process or container limit. Three web workers plus the ingester normally have four such caches;
KV connections have their own settings, and import/export workers add connections while active.
Reducing 16 MiB to 8 MiB on four main connections cannot by itself fix gigabyte-scale request
retention. The observed November OOMs do not establish mmap as their cause; mmap was disabled.

Benchmark changes on an isolated database copy before changing production settings. Measure
anonymous memory, proportional file memory, cgroup anonymous/file totals, host PSI and request
latency together. Warm-file-cache timings are not cold-disk or memory-pressure evidence. A
mapped-size increase can raise process RSS without allocating an equivalent new physical cache.

`DB_TEMP_STORE=MEMORY|FILE` controls temporary storage on main-database connections only;
the default remains `MEMORY`. `FILE` permits spilling, not zero-memory intermediates. For a
disk-backed trial, set `SQLITE_TMPDIR` before process startup to an existing writable/searchable
directory with sufficient disk space. SQLite can fall back when a configured directory is unusable;
verify the actual mount and open `etilqs` file descriptors (temporary files are unlinked while open).
tmpfs defeats the disk-spill intent. Do not use the deprecated, thread-unsafe
`PRAGMA temp_store_directory`. This does not relocate database/WAL files or export/library paths.

November 8's isolated 299 MiB synthetic database benchmark used fresh Bun processes, warm OS
file cache, three randomized runs per configuration, and a verified disk-backed btrfs temp directory:

| Main cache / mmap / temporary storage | Median peak anonymous MiB | Median sort ms |
| ------------------------------------- | ------------------------: | -------------: |
| 16 MiB / off / MEMORY                 |                     72.79 |          48.95 |
| 8 MiB / off / MEMORY                  |                     62.17 |          50.90 |
| 8 MiB / 256 MiB / MEMORY              |                     60.26 |          35.71 |
| 8 MiB / 1 GiB / MEMORY                |                     52.24 |          43.20 |
| 8 MiB / off / FILE                    |                     37.67 |          68.96 |

The 1 GiB setting mapped only the actual 299 MiB fixture. FILE reduced the sort's anonymous peak
by 24.5 MiB but raised median sort time by 35.5% and wrote about 97 MiB across three sorts;
retained anonymous memory was roughly unchanged. All configurations already had the same file
resident in OS cache. Three simultaneous mapped readers totaled about 952 MiB RSS but only
323 MiB PSS, demonstrating shared physical pages, not three database copies. These are local
warm-case medians, not production tail-latency or pressure guarantees; no existing default changed.

## Session and log retention

The in-memory OAuth client cache holds at most 1,000 entries per isolate, with the existing
ten-minute expiry and a once-minute unref'd dormant-expiry sweep. Event-loop stalls can delay
reclamation; eviction never deletes a durable grant or logs the user out.

OpenObserve shipping reserves credits before posting to its worker: at most 1 MiB of serialized
UTF-8 payload, 1,024 messages and 64 KiB per line per logger isolate. Credits cover mailbox,
worker queue and actual HTTP/body-cancellation settlement, and release only on acknowledgement.
The worker independently enforces those bounds, sends one request at a time, and drops failed
batches rather than retrying indefinitely. Oversized/saturated shipping is shed without delaying
stdout. Diagnostic response bodies are prefix-bounded before cancellation; shipping diagnostics
go only to stdout to avoid recursion. These are retention safeguards, not an identified OOM cause.

## Bounded-resource samples

`runtime_sample.resources` records per-process snapshots for `session_cache`, `log_shipping`,
`search`, `multipart_upload`, `csv_import` and `export_worker`. Counters are cumulative until that isolate restarts;
an unconfigured log shipper is `null`. Log-shipping byte credits measure serialized UTF-8 payloads,
not exact heap usage, and include messages awaiting worker acknowledgement. Search counters
describe admission work, not HTTP connections. Upload/import admission includes processing after
parsing; a zero pending count does not mean no busy requests were rejected.

Page-cache extraction counters are top-level `page_cache_active_fills`,
`page_cache_buffered_bytes` and `page_cache_skipped_fills`; byte accounting covers retained
extraction chunks only, not original bodies, concatenation, gzip or cached-hit decompression.
These snapshots avoid identity/URL labels and do not clone request or response bodies. Limits
are per process unless explicitly documented otherwise, so worker/thread multipliers matter.

Export preparation uses a short-lived worker with small private SQLite caches and mmap disabled;
hashing reads 64 KiB chunks and sanitized KV copies iterate rows rather than loading a table.
A persistent, dedicated SQLite lock file in the export directory admits one export across the
cluster, including download, tar/gzip shutdown and cleanup. It never locks the authentication KV
database. Busy requests receive 503 with `Retry-After: 60`. Never unlink that lock file while the
service is running. Cancellation and the 30-minute preparation deadline request cooperative
shutdown: native VACUUM must finish before ownership is released. An unexpected worker failure
fails closed rather than assuming termination stopped native work; `failedClosed` exposes this
condition. Crash leftovers require deliberate cleanup, not a sweep of other jobs' directories.

## Upload, import and search admission

Each web process admits one multipart ebook upload and one CSV import, with no waiting queue,
before parsing multipart data. Parsing has an absolute five-minute deadline; timeout cancels
the input and releases admission only after the parser settles. Actual wire bytes, not only Content-Length, are limited; the
accepted multipart file is still materialized in memory. CSV input remains capped at 50 MiB
and transferred to its worker. Authentication precedes upload, and the stored OAuth session is
read again immediately before worker startup to include concurrent token refreshes.
Two-pass processing avoids retaining every parsed row, while
the complete unmatched report, one unusually large row and the book-only PDS map can still
grow within the input/library size. Progress events await SSE acknowledgement, bounding the
cross-thread backlog; disconnect/timeout stops the import worker. Admissions are not a hard
cluster-wide RAM cap and do not cover raw XRPC ebook uploads' existing streaming path.

Catalogue searches admit at most three distinct cache misses and 64 queued misses per process,
with a 60-second queue deadline. The gate runs inside cache loading, so fresh hits and identical
in-flight queries do not occupy separate slots. Background warming retains its existing separate
bounded admission and uses the same miss gate. This is not an additional enrichment request
rate limiter or a Goodreads circuit breaker. Under saturation best-effort searches can fall back
to the existing empty-result behavior; resource samples expose active and waiting work.

### Best-effort shipping failure policy

Three **consecutive connection refusals** disable shipping: pending entries are dropped, timers
are cancelled, and subsequent messages are counted/dropped without retaining their payloads.
Any HTTP response or non-refusal failure breaks that refusal streak. Recovery requires a
worker/process restart; the parent initializes once, and repeated `init` messages are ignored.
There are no periodic probes or automatic replay. Production batch/deadline limits are fixed,
not configurable. Structured shipping diagnostics go only to stdout. Worker capacity drops are
coalesced instead of warning per message; parent admission drops are exposed in resource counters.
Capacity drops also schedule one coalesced 5s diagnostic timer, even when every entry is
oversized and no batch can be sent. Further drops do not postpone that report; a batch
settlement reports sooner and cancels the pending diagnostic timer. It retains no payloads
and stops when there are no further capacity drops. Permanent disable cancels it;
subsequent disabled drops never schedule diagnostics.
This deliberately trades remote log completeness
for bounded retained payloads without changing local stdout delivery.
