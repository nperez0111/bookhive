/// Ebook metadata parse — runs off the main thread as a single-shot Bun Worker.
///
/// `parseBook` (fflate `unzipSync`) and `prepareCover` (SVG rasterization via
/// `resvg`, which renders synchronously) are the only CPU-bound, whole-file
/// steps of an upload. Running them here keeps a 100 MB unzip or a synchronous
/// raster from stalling the request process's event loop.
///
/// One Worker is spawned per upload and terminated by the caller on every path
/// (`parseBookInWorker` in `parse-client.ts`); the upload's parse semaphore
/// still bounds how many run at once, so at most UPLOAD_PARSE_CONCURRENCY of
/// these exist per process. The file is read here from its path — the caller
/// already streamed it to disk, so only a path crosses in.

import { parseBook, prepareCover } from "../utils/bookMetadata/index";
import type { ParseRequest, ParseResponse } from "./parse-messages";

declare var self: Worker;

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, path, filename, formatInfo } = event.data;
  try {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const metadata = parseBook(bytes, filename, formatInfo);
    const cover = (await prepareCover(metadata.cover)) ?? undefined;
    // Drop the raw parsed cover: `prepareCover` already produced the one we
    // keep, and shipping the un-rasterized original back would double the bytes
    // crossing the boundary for nothing.
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
      error: error instanceof Error ? error.message : String(error),
    } satisfies ParseResponse);
  }
};
