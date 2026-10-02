/// Main-thread side of the single-shot EPUB conversion Worker.

import type { ConvertRequest } from "./convert-messages";
import { runSingleShot, workerUrl } from "./singleShot";

const WORKER_URL = workerUrl(import.meta.url, "convert-worker");

/** Hard ceiling on one conversion — a hang breaker, not a performance budget; a blown deadline terminates the Worker rather than leaving it holding two whole-file buffers forever. */
const CONVERT_TIMEOUT_MS = 60_000;

/** Convert an ebook in a throwaway Worker; only paths cross the boundary, so the result is never structured-cloned. */
export async function convertInWorker(sourcePath: string, destPath: string): Promise<number> {
  const { sizeBytes } = await runSingleShot<{ sizeBytes: number }>({
    workerUrl: WORKER_URL,
    payload: { sourcePath, destPath } satisfies Omit<ConvertRequest, "id">,
    timeoutMs: CONVERT_TIMEOUT_MS,
    label: "epub conversion",
  });
  return sizeBytes;
}
