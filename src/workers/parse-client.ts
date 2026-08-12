/// Main-thread side of the single-shot ebook parse Worker.

import { randomUUID } from "node:crypto";
import type { BookCover, BookMetadata, FormatInfo } from "../utils/bookMetadata/index";
import type { ParseRequest, ParseResponse } from "./parse-messages";

// When running the Nitro bundle (.output/server/index.mjs) load the pre-built
// worker; in dev load the TS entry directly. Same idiom as every other worker.
const isBundled = import.meta.url.includes(".output/");
const WORKER_URL = isBundled
  ? new URL("./workers/parse-worker.js", import.meta.url).href
  : new URL("./parse-worker.ts", import.meta.url).href;

/**
 * Hard ceiling on one parse. Generous: a 100 MB unzip plus an SVG raster is well
 * under this, and the upload's parse semaphore already limits how many run. A
 * blown deadline terminates the Worker rather than hanging the request.
 */
const PARSE_TIMEOUT_MS = 60_000;

export type ParsedBook = { metadata: BookMetadata; cover: BookCover | undefined };

/**
 * Parse an ebook in a throwaway Worker, reading it from `path` (already on
 * disk). The Worker is terminated on every path — a fresh VM per upload is how
 * the whole-file buffer is shed without a long-lived pool.
 */
export function parseBookInWorker(
  path: string,
  filename: string,
  formatInfo: FormatInfo,
): Promise<ParsedBook> {
  const worker = new Worker(WORKER_URL);
  const id = randomUUID();

  return new Promise<ParsedBook>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("ebook parse timed out"))),
      PARSE_TIMEOUT_MS,
    );

    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      const res = event.data;
      if (res.id !== id) return; // ignore a stale reply from a worker we gave up on
      if (res.ok) finish(() => resolve({ metadata: res.metadata, cover: res.cover }));
      else finish(() => reject(new Error(res.error)));
    };
    worker.onerror = (error) => {
      finish(() => reject(new Error(`parse worker error: ${error.message}`)));
    };

    worker.postMessage({ id, path, filename, formatInfo } satisfies ParseRequest);
  });
}
