import type { ExportOptions, PrepareResult } from "../data/dbExport";
import type { ExportRequest } from "./export-worker";
import { workerUrl, type SingleShotReply } from "./singleShot";

const stats = { active: 0, cancellationRequested: 0, failedClosed: 0 };
/** Per-web-process counts, not cluster totals. No paths or authorization data. */
export function getExportWorkerStats() {
  return { ...stats };
}

/** Unlike runSingleShot, abort/deadline must not terminate native VACUUM and
 * pretend it finished. Hold ownership until the worker acknowledges quiescence.
 * A wedged native call deliberately fails closed (one held export, no overlap).
 */
export function prepareExportInWorker(
  options: ExportOptions,
  job: PrepareResult,
  signal?: AbortSignal,
  timeoutMs = 30 * 60_000,
): Promise<PrepareResult> {
  if (signal?.aborted) return Promise.reject(new Error("Export preparation cancelled"));
  const worker = new Worker(workerUrl(import.meta.url, "export-worker"));
  stats.active++;
  const id = crypto.randomUUID();
  const cancellation = new SharedArrayBuffer(4);
  return new Promise((resolve, reject) => {
    let cancellationError: Error | undefined;
    const cancel = () => {
      if (!Atomics.load(new Int32Array(cancellation), 0)) stats.cancellationRequested++;
      cancellationError ??= new Error("Export preparation cancelled");
      Atomics.store(new Int32Array(cancellation), 0, 1);
    };
    const timer = setTimeout(() => {
      cancellationError = new Error("Export preparation timed out");
      cancel();
    }, timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    worker.onmessage = (event: MessageEvent<SingleShotReply<PrepareResult>>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      stats.active--;
      if (Atomics.load(new Int32Array(cancellation), 0)) stats.cancellationRequested--;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      if (cancellationError) reject(cancellationError);
      else if (reply.ok) resolve(reply);
      else reject(new Error(reply.error));
    };
    // Unexpected VM errors give no safe acknowledgement of native quiescence.
    // Retain the lock rather than guessing that Bun's early close means exit.
    worker.onerror = () => {
      stats.failedClosed++;
      cancel();
    };
    try {
      worker.postMessage({ id, options, job, cancellation } satisfies ExportRequest);
    } catch (error) {
      stats.active--;
      if (Atomics.load(new Int32Array(cancellation), 0)) stats.cancellationRequested--;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      reject(error); // no request was sent, therefore no file work began
    }
  });
}
