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
