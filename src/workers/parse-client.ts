/// Main-thread side of the single-shot ebook parse Worker.

import type { BookCover, BookMetadata, FormatInfo } from "../core/bookMetadata/index";
import type { ParseRequest } from "./parse-messages";
import { runSingleShot, workerUrl } from "./singleShot";

const WORKER_URL = workerUrl(import.meta.url, "parse-worker");

/**
 * Hard ceiling on one parse — generous, since the upload's parse semaphore
 * already limits how many run. A blown deadline terminates the Worker rather
 * than hanging the request.
 */
const PARSE_TIMEOUT_MS = 60_000;

export type ParsedBook = { metadata: BookMetadata; cover: BookCover | undefined };

/**
 * Parse an ebook in a throwaway Worker, reading it from `path` (already on
 * disk). The Worker is terminated on every path — a fresh VM per upload is how
 * the whole-file buffer is shed without a long-lived pool.
 */
export async function parseBookInWorker(
  path: string,
  filename: string,
  formatInfo: FormatInfo,
): Promise<ParsedBook> {
  const { metadata, cover } = await runSingleShot<ParsedBook>({
    workerUrl: WORKER_URL,
    payload: { path, filename, formatInfo } satisfies Omit<ParseRequest, "id">,
    timeoutMs: PARSE_TIMEOUT_MS,
    label: "ebook parse",
  });
  return { metadata, cover };
}
