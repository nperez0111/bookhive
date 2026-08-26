/**
 * MOBI/AZW3 → EPUB conversion.
 *
 * This module is the whole seam: callers pass paths and get a result back, and
 * nothing outside knows that a WASM build of `boko` in a throwaway Worker does
 * the work. Keep it that way — the implementation has already changed once.
 *
 * **Licensing.** boko is GPL-3.0-or-later and BookHive is MIT. The WASM module
 * is linked into our own process, which under the FSF's reading makes the
 * *distributed* result a combined work, and this repo is public and publishes
 * container images. That was a deliberate, informed choice; don't quietly undo
 * it, and don't quietly deepen it. `vendor/boko/` carries the GPL text that must
 * travel with the binary and a `manifest.json` naming the exact upstream commit
 * that is its corresponding source — both written by `scripts/build-boko-wasm.ts`,
 * which is also the only supported way to bump the version.
 *
 * **Measured** (v0.5.0, real Project Gutenberg files): a 235 KB MOBI converts in
 * 30 ms, a 24 MB AZW3 in 63 ms, keeping all 165 illustrations. Known upstream
 * defect: boko drops stylesheets while leaving `<link>` references to them, so
 * the output fails `epubcheck` even though every reader opens it. That is why
 * the original upload is never deleted.
 */
import { env } from "../env";
import { convertInWorker } from "../workers/convert-client";
import { Semaphore } from "./semaphore";

/**
 * Formats worth converting. EPUB obviously needs nothing; FB2 and CBZ are
 * *not* here because boko cannot read them — they still reach e-readers in
 * their own format and are the remaining gap in "only serve EPUBs".
 */
const CONVERTIBLE_FORMATS = new Set(["mobi"]);

/**
 * Bounds concurrent conversion Workers per app process, and with them the
 * native memory they hold: `boko.convert` keeps the whole input and the whole
 * output live at once, so this is the same kind of bound that
 * `UPLOAD_PARSE_CONCURRENCY` already expresses for the parse step. Shared
 * rather than given its own knob because the two never run at the same moment
 * for a given upload.
 */
const convertSemaphore = new Semaphore(env.UPLOAD_PARSE_CONCURRENCY, {
  label: "epub-convert",
});

export type ConvertResult =
  | { ok: true; sizeBytes: number }
  /**
   * Every failure is non-fatal and carries a reason for the caller's wide
   * event. An upload must never fail because a *derived* file could not be
   * produced — the original is already on disk and is what the user gave us.
   */
  | { ok: false; reason: "unsupported" | "timeout" | "failed"; detail?: string };

/** Does this format have an EPUB conversion at all? */
export function isConvertibleToEpub(format: string | null | undefined): boolean {
  return CONVERTIBLE_FORMATS.has((format || "").toLowerCase());
}

/**
 * Convert `sourcePath` to an EPUB at `destPath`.
 *
 * Returns a result rather than throwing, because there is no failure here the
 * caller should propagate: the book is already stored and downloadable in its
 * original format.
 */
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
    const detail = err instanceof Error ? err.message : String(err);
    if (detail.includes("timed out")) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "failed", detail: detail.slice(0, 200) };
  } finally {
    release();
  }
}
