/// Main-thread side of a single-shot Worker: spawn, ask one question, terminate.

import { randomUUID } from "node:crypto";

/**
 * **The one** request/reply-then-die Worker driver — `parse-client.ts` and
 * `convert-client.ts` duplicated this exact logic because the work is
 * synchronous and holds whole-file buffers, so it must run off the request
 * thread, and a fresh VM per job is how that memory is shed without a pool.
 *
 * Deliberately **not** used by `src/scrapers/waf/solver.ts`: that one's
 * invariant is at most one solver Worker per process, and `waf/README.md`
 * explains why giving it a queue, pool or retry previously caused an outage.
 *
 * Terminating on every path is the whole point — a Worker that outlives its
 * reply is a leaked VM plus whatever native memory it is holding.
 */
export type SingleShotReply<TResult> = { id: string } & (
  | ({ ok: true } & TResult)
  | { ok: false; error: string }
);

export function runSingleShot<TResult, TPayload extends object = object>({
  workerUrl,
  payload,
  timeoutMs,
  /** Names the worker in timeout/crash messages, e.g. "ebook parse". */
  label,
}: {
  workerUrl: string;
  /** Merged with the generated `id`; the Worker echoes the id back. */
  payload: TPayload;
  timeoutMs: number;
  label: string;
}): Promise<TResult> {
  const worker = new Worker(workerUrl);
  const id = randomUUID();

  return new Promise<TResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`${label} timed out`))),
      timeoutMs,
    );

    worker.onmessage = (event: MessageEvent<SingleShotReply<TResult>>) => {
      const res = event.data;
      if (res.id !== id) return; // ignore a stale reply from a worker we gave up on
      if (res.ok) finish(() => resolve(res as unknown as TResult));
      else finish(() => reject(new Error(res.error)));
    };
    worker.onerror = (error) => {
      finish(() => reject(new Error(`${label} worker error: ${error.message}`)));
    };

    worker.postMessage({ id, ...payload });
  });
}

/**
 * Where a worker entry lives: the pre-built bundle under `.output/server/` in
 * production, the TS entry in dev. Resolved against the *calling* module's URL,
 * which is why this takes one rather than computing it.
 */
export function workerUrl(callerUrl: string, name: string): string {
  return callerUrl.includes(".output/")
    ? new URL(`./workers/${name}.js`, callerUrl).href
    : new URL(`./${name}.ts`, callerUrl).href;
}
