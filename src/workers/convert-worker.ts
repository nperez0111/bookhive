/// MOBI/AZW3 → EPUB conversion — runs off the main thread as a single-shot Bun
/// Worker because `boko.convert` is a **synchronous** WASM call that would
/// otherwise stall the event loop of a process serving a third of all traffic.
///
/// Only paths cross the boundary: the worker reads the source itself and writes
/// the EPUB itself, so a 25 MB result never gets structured-cloned.

import { convert } from "../../vendor/boko/boko.js";
import type { ConvertRequest, ConvertResponse } from "./convert-messages";
import { errorMessage } from "../lib/errors";

declare var self: Worker;

/**
 * Format names to try as boko's `from`, best first — a dual-format Kindle file
 * contains both an old MOBI 6 part and a modern KF8 part, and boko converts
 * whichever one you name, so `azw3` is tried first (falling back cheaply on a
 * plain MOBI) to get the better half of every dual-format book without
 * trusting the uploaded file's extension.
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
        lastError = errorMessage(err);
      }
    }
    if (!output) throw new Error(lastError || "conversion produced no output");

    await Bun.write(destPath, output);
    self.postMessage({ id, ok: true, sizeBytes: output.byteLength } satisfies ConvertResponse);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: errorMessage(error),
    } satisfies ConvertResponse);
  }
};
