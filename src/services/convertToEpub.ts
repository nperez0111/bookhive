/**
 * MOBI/AZW3 → EPUB conversion. This module is the whole seam — callers pass
 * paths and get a result back — and nothing outside should know that a WASM
 * build of `boko` in a throwaway Worker does the work.
 *
 * Licensing: boko is GPL-3.0-or-later and BookHive is MIT; linking the WASM
 * module into our process and publishing container images is a deliberate,
 * informed choice — don't quietly undo or deepen it. `vendor/boko/` carries
 * the required GPL text and a manifest naming the upstream commit;
 * `scripts/build-boko-wasm.ts` is the only supported way to bump the version.
 *
 * Known upstream defect: boko drops stylesheets while leaving `<link>`
 * references to them, so output fails `epubcheck` even though every reader
 * opens it — this is why the original upload is never deleted.
 */
import { env } from "../env";
import { convertInWorker } from "../workers/convert-client";
import { Semaphore } from "../lib/semaphore";
import { errorMessage } from "../lib/errors";

// FB2 and CBZ are deliberately absent — boko cannot read them, so they still
// reach e-readers in their own format.
const CONVERTIBLE_FORMATS = new Set(["mobi"]);

/**
 * Bounds concurrent conversion Workers, and with them the native memory
 * `boko.convert` holds for the whole input and output at once. Shares
 * `UPLOAD_PARSE_CONCURRENCY` rather than its own knob since the two steps
 * never run at the same moment for a given upload.
 */
const convertSemaphore = new Semaphore(env.UPLOAD_PARSE_CONCURRENCY, {
  label: "epub-convert",
});

export type ConvertResult =
  | { ok: true; sizeBytes: number }
  // Every failure is non-fatal: an upload must never fail because a derived
  // file could not be produced — the original is already on disk.
  | { ok: false; reason: "unsupported" | "timeout" | "failed"; detail?: string };

export function isConvertibleToEpub(format: string | null | undefined): boolean {
  return CONVERTIBLE_FORMATS.has((format || "").toLowerCase());
}

/** Returns a result rather than throwing — the book is already stored and downloadable as-is. */
export async function convertToEpub(
  sourcePath: string,
  destPath: string,
  format: string | null | undefined,
): Promise<ConvertResult> {
  if (!isConvertibleToEpub(format)) return { ok: false, reason: "unsupported" };

  const release = await convertSemaphore.acquireSlot();
  try {
    const sizeBytes = await convertInWorker(sourcePath, destPath);
    // Success with no bytes is still a failure as far as we are concerned:
    // `epubPath` must never point at something we cannot serve.
    if (sizeBytes <= 0) return { ok: false, reason: "failed", detail: "converter wrote no output" };
    return { ok: true, sizeBytes };
  } catch (err) {
    const detail = errorMessage(err);
    if (detail.includes("timed out")) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "failed", detail: detail.slice(0, 200) };
  } finally {
    release();
  }
}
