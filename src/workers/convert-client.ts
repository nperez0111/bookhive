/// Main-thread side of the single-shot EPUB conversion Worker.

import { randomUUID } from "node:crypto";
import type { ConvertRequest, ConvertResponse } from "./convert-messages";

// When running the Nitro bundle (.output/server/index.mjs) load the pre-built
// worker; in dev load the TS entry directly. Same idiom as every other worker.
const isBundled = import.meta.url.includes(".output/");
const WORKER_URL = isBundled
  ? new URL("./workers/convert-worker.js", import.meta.url).href
  : new URL("./convert-worker.ts", import.meta.url).href;

/**
 * Hard ceiling on one conversion. Generous by three orders of magnitude — the
 * measured worst case is 63 ms for a 24 MB AZW3 — because this is a hang
 * breaker, not a performance budget. A blown deadline terminates the Worker
 * rather than leaving it holding two whole-file buffers forever.
 */
const CONVERT_TIMEOUT_MS = 60_000;

/**
 * Convert an ebook in a throwaway Worker. Both paths are on disk already and
 * only paths cross the boundary, so a 25 MB result is never structured-cloned.
 * Resolves with the written size; rejects on any converter error.
 */
export function convertInWorker(sourcePath: string, destPath: string): Promise<number> {
  const worker = new Worker(WORKER_URL);
  const id = randomUUID();

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("epub conversion timed out"))),
      CONVERT_TIMEOUT_MS,
    );

    worker.onmessage = (event: MessageEvent<ConvertResponse>) => {
      const res = event.data;
      if (res.id !== id) return; // ignore a stale reply from a worker we gave up on
      if (res.ok) finish(() => resolve(res.sizeBytes));
      else finish(() => reject(new Error(res.error)));
    };
    worker.onerror = (error) => {
      finish(() => reject(new Error(`convert worker error: ${error.message}`)));
    };

    worker.postMessage({ id, sourcePath, destPath } satisfies ConvertRequest);
  });
}
