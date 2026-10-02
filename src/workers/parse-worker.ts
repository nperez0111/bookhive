/// Ebook metadata parse — runs off the main thread as a single-shot Bun Worker.
///
/// `parseBook` (fflate `unzipSync`) and `prepareCover` (synchronous SVG raster
/// via `resvg`) are the only CPU-bound, whole-file steps of an upload; running
/// them here keeps them from stalling the request process's event loop.
///
/// The Worker is terminated by the caller on every path, and the upload's
/// parse semaphore bounds how many run at once. Only a path crosses in — the
/// caller already streamed the file to disk.

import { parseBook, prepareCover } from "../core/bookMetadata/index";
import type { ParseRequest, ParseResponse } from "./parse-messages";
import { errorMessage } from "../lib/errors";

declare var self: Worker;

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, path, filename, formatInfo } = event.data;
  try {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const metadata = parseBook(bytes, filename, formatInfo);
    const cover = (await prepareCover(metadata.cover)) ?? undefined;
    // Drop the raw parsed cover — `prepareCover` already produced the one we
    // keep, and shipping the original back would double the bytes for nothing.
    self.postMessage({
      id,
      ok: true,
      metadata: { ...metadata, cover: undefined },
      cover,
    } satisfies ParseResponse);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: errorMessage(error),
    } satisfies ParseResponse);
  }
};
