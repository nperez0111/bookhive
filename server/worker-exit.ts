/**
 * Classification of a worker process exit, split out of `cluster.ts` so it can
 * be unit-tested. Zero dependencies — the Dockerfile copies this file verbatim
 * next to `cluster.ts` and Bun runs the TS source directly.
 *
 * Worker deaths were effectively invisible: the app logged 82 error-level lines
 * against 171,145 user-visible 502s on 2026-08-01, because the failure mode was
 * process death rather than an exception. A cgroup OOM kill arrives as SIGKILL
 * with a null exit code and never touches the container's RestartCount, so this
 * JSON line is the only in-app signal that it happened.
 */
import { readFileSync } from "node:fs";

/**
 * Bun's `Bun.spawn` `onExit` hands back the signal *name* (`"SIGKILL"`), not a
 * number — its own type declaration says `number`, which is what the original
 * code trusted. `SIGNAL_NAMES["SIGKILL"]` missed, fell through to the
 * `` `SIG${code}` `` fallback and produced **`"SIGSIGKILL"`**, so
 * `likely_oom` was permanently false and the runbook's page condition
 * (`worker_exit AND likely_oom=true`) could never fire — through 148 OOM kills.
 *
 * Both shapes are handled here so a future Bun release that makes the types
 * honest doesn't silently reintroduce the bug.
 */
const SIGNAL_NAMES: Record<number, string> = {
  2: "SIGINT",
  6: "SIGABRT",
  9: "SIGKILL",
  11: "SIGSEGV",
  15: "SIGTERM",
};

export function signalName(signalCode: number | string | null | undefined): string | null {
  if (signalCode === null || signalCode === undefined) return null;
  if (typeof signalCode === "string") {
    return signalCode.startsWith("SIG") ? signalCode : `SIG${signalCode}`;
  }
  return SIGNAL_NAMES[signalCode] ?? `SIG${signalCode}`;
}

export type WorkerExitEvent = {
  level: 50;
  msg: "worker_exit";
  worker: number;
  pid: number | null;
  code: number | null;
  signal: string | null;
  likely_oom: boolean;
  uptime_ms: number;
  rss_kb?: number;
  anon_kb?: number;
};

export function classifyWorkerExit(args: {
  index: number;
  pid?: number | null;
  exitCode: number | null;
  signalCode: number | string | null | undefined;
  uptimeMs: number;
  memory?: { rss_kb?: number; anon_kb?: number } | null;
}): WorkerExitEvent {
  const signal = signalName(args.signalCode);
  return {
    level: 50,
    msg: "worker_exit",
    worker: args.index,
    pid: args.pid ?? null,
    code: args.exitCode,
    signal,
    // A cgroup OOM kill is SIGKILL with no exit code. A SIGKILL that *does*
    // carry an exit code came from somewhere else and shouldn't page as an OOM.
    likely_oom: signal === "SIGKILL" && args.exitCode === null,
    uptime_ms: args.uptimeMs,
    ...(args.memory?.rss_kb !== undefined ? { rss_kb: args.memory.rss_kb } : {}),
    ...(args.memory?.anon_kb !== undefined ? { anon_kb: args.memory.anon_kb } : {}),
  };
}

/**
 * Memory footprint of a live worker, read from procfs.
 *
 * Must be sampled *while the worker is running* — by the time `onExit` fires,
 * `/proc/<pid>` is gone, which is why the supervisor polls and reports the last
 * sample rather than reading on death.
 *
 * `Anonymous` is the number that matters. A worker's `Rss` also counts the
 * ~1 GB clean, shared, file-backed SQLite mmap, which is reclaimable; that term
 * is what made per-worker RSS readings look alarming during the incident while
 * the actual anonymous growth went unattributed. Returns null off Linux (dev).
 */
export function readProcessMemoryKb(
  pid: number,
  readFile: (path: string) => string = defaultReadFile,
): { rss_kb?: number; anon_kb?: number } | null {
  try {
    const text = readFile(`/proc/${pid}/smaps_rollup`);
    const rss = /^Rss:\s+(\d+) kB$/m.exec(text);
    const anon = /^Anonymous:\s+(\d+) kB$/m.exec(text);
    if (!rss && !anon) return null;
    return {
      ...(rss?.[1] ? { rss_kb: Number(rss[1]) } : {}),
      ...(anon?.[1] ? { anon_kb: Number(anon[1]) } : {}),
    };
  } catch {
    return null;
  }
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}
