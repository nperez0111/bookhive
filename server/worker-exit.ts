/**
 * Classification of a worker process exit, split out of `cluster.ts` so it can
 * be unit-tested. Zero dependencies — the Dockerfile copies this file verbatim
 * next to `cluster.ts`.
 *
 * A cgroup OOM kill arrives as SIGKILL with a null exit code and never touches
 * the container's RestartCount, so this JSON line is the only in-app signal
 * that it happened.
 */
import { readFileSync } from "node:fs";

/**
 * Bun's `Bun.spawn` `onExit` hands back the signal *name* (`"SIGKILL"`), not a
 * number, despite its own type declaration saying `number`. Both shapes are
 * handled here so trusting the type doesn't silently reintroduce the bug.
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
    // A cgroup OOM kill is SIGKILL with no exit code; a SIGKILL with one came from somewhere else and isn't an OOM.
    likely_oom: signal === "SIGKILL" && args.exitCode === null,
    uptime_ms: args.uptimeMs,
    ...(args.memory?.rss_kb !== undefined ? { rss_kb: args.memory.rss_kb } : {}),
    ...(args.memory?.anon_kb !== undefined ? { anon_kb: args.memory.anon_kb } : {}),
  };
}

/**
 * Memory footprint of a live worker, read from procfs. Must be sampled while
 * the worker is running — `/proc/<pid>` is gone by the time `onExit` fires.
 *
 * `Anonymous` is the number that matters; `Rss` also counts the shared,
 * reclaimable file-backed SQLite mmap, which makes it look alarming for no
 * reason. Returns null off Linux (dev).
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
