/// MOBI/AZW3 → EPUB conversion — runs off the main thread as a single-shot Bun
/// Worker, for the same two reasons the parse worker exists.
///
/// `boko.convert` is a **synchronous** WASM call that takes the whole input as
/// one `Uint8Array` and returns the whole output as another. On the request
/// thread that would mean both a stalled event loop and up to ~200 MB of live
/// buffers (a 100 MB upload plus its conversion) in a process that serves a
/// third of all traffic. Here it costs a Worker that the caller terminates on
/// every path.
///
/// Only paths cross the boundary: the worker reads the source itself and writes
/// the EPUB itself, so a 25 MB result never gets structured-cloned.

import { convert } from "../../vendor/boko/boko.js";
import type { ConvertRequest, ConvertResponse } from "./convert-messages";

declare var self: Worker;

/**
 * Format names to try as boko's `from`, best first.
 *
 * This is not redundancy, it is a quality choice. `personal_book.format` is
 * `"mobi"` for `.mobi`, `.azw` and `.azw3` alike (`EXT_FORMAT` in
 * `bookMetadata/index.ts`), but a dual-format Kindle file contains both an old
 * MOBI 6 part and a modern KF8 part — and boko converts whichever one you name.
 * Measured on Project Gutenberg's Pride and Prejudice: declaring `azw3` yields
 * 76 chapters and 246 files, declaring `mobi` yields 64 and 234. Asking for
 * `azw3` first and falling back costs one cheap rejected header read on a plain
 * MOBI ("unsupported format: not a KF8/AZW3 file") and gets the better half of
 * every dual-format book, without trusting the uploaded file's extension.
 */
const SOURCE_FORMATS = ["azw3", "mobi"] as const;

self.onmessage = async (event: MessageEvent<ConvertRequest>) => {
  const { id, sourcePath, destPath } = event.data;
  try {
    const bytes = new Uint8Array(await Bun.file(sourcePath).arrayBuffer());

    let output: Uint8Array | null = null;
    let lastError = "";
    for (const from of SOURCE_FORMATS) {
      try {
        output = convert(bytes, from, "epub");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    if (!output) throw new Error(lastError || "conversion produced no output");

    await Bun.write(destPath, output);
    self.postMessage({ id, ok: true, sizeBytes: output.byteLength } satisfies ConvertResponse);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ConvertResponse);
  }
};
