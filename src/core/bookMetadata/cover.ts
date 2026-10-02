// Cover validation and normalization. Validates an extracted cover before
// storing it and falls back to a generated placeholder when it doesn't hold up.

import { imageMeta } from "image-meta";
import { Resvg } from "@resvg/resvg-js";
import type { BookCover } from "./types";
import { mimeForExt } from "./shared";

/** Minimum width/height (px) for a cover to be considered "real". */
export const MIN_COVER_DIMENSION = 16;

/**
 * Largest cover we will decompress out of an archive, checked against the
 * ZIP central directory's claimed size ahead of inflating anything.
 */
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

/**
 * Width we rasterize an SVG cover to — covers a 2x display of the largest
 * on-page size (~300 CSS px). `resvg` renders synchronously, so raster cost
 * scales with the square of this number; keep it low.
 */
const SVG_RASTER_WIDTH = 700;

/** Quality for the JPEG we transcode a rasterized SVG to. */
const SVG_JPEG_QUALITY = 82;

function looksLikeSvg(bytes: Uint8Array): boolean {
  // Sniff rather than trust the extension: `mimeForExt` is driven by the name
  // inside the archive, and the manifest can lie.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 1024));
  return /<svg[\s>]/i.test(head);
}

/**
 * Turn an SVG cover into a raster one, or return null if it can't be rendered.
 *
 * **An SVG cover is not a wrapper around an image** — it is a composition.
 * Standard Ebooks ships every cover as an SVG holding the artwork in an
 * `<image>` element *plus* the title and author as vector `<path>`s over it.
 * Extracting the embedded raster drops the title/author; rendering only the
 * vector layer drops the artwork — only a real SVG renderer produces the
 * actual cover.
 *
 * Output is JPEG rather than WebP because these covers are served to OPDS
 * clients and e-readers whose format support is unreliable and unknowable.
 */
async function rasterizeSvgCover(bytes: Uint8Array): Promise<BookCover | null> {
  try {
    // `resvg` renders synchronously on this thread, bounded by MAX_COVER_BYTES
    // on the way in and SVG_RASTER_WIDTH on the way out.
    const png = new Resvg(Buffer.from(bytes), {
      fitTo: { mode: "width", value: SVG_RASTER_WIDTH },
      // Transparency would otherwise flatten to black once encoded to JPEG.
      background: "white",
      // Skip the host font scan: these covers carry text as outlined vector
      // paths, so no fonts are needed.
      font: { loadSystemFonts: false },
    })
      .render()
      .asPng();

    const jpeg = await new Bun.Image(png).jpeg({ quality: SVG_JPEG_QUALITY }).bytes();
    if (!jpeg || jpeg.length === 0) return null;
    return { bytes: jpeg, mime: mimeForExt("jpg"), ext: "jpg" };
  } catch {
    // A malformed or unrenderable SVG is a missing cover, not a failed upload.
    return null;
  }
}

/**
 * Confirm the bytes are a real, sensibly-sized image.
 *
 * Uses `image-meta` (header parse, no pixel decode) rather than Bun's native
 * image pipeline, which rejects SVG outright as an "unrecognised format".
 */
export function isUsableCover(bytes: Uint8Array | undefined | null): boolean {
  if (!bytes || bytes.length === 0) return false;
  try {
    const { width, height } = imageMeta(bytes);
    return (
      typeof width === "number" &&
      typeof height === "number" &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width >= MIN_COVER_DIMENSION &&
      height >= MIN_COVER_DIMENSION
    );
  } catch {
    return false;
  }
}

/**
 * The one gate between "the parser found something" and "we store a cover":
 * rasterizes SVG, then validates whatever we ended up with. Returns null when
 * there is no cover worth keeping.
 *
 * `coverPath IS NOT NULL` is the only signal driving `coverUrl` on the web
 * library, the OPDS feed and the XRPC book view, so anything that gets past
 * here has to actually render in all three.
 */
export async function prepareCover(cover: BookCover | null | undefined): Promise<BookCover | null> {
  if (!cover?.bytes || cover.bytes.length === 0) return null;

  const resolved = looksLikeSvg(cover.bytes) ? await rasterizeSvgCover(cover.bytes) : cover;
  if (!resolved) return null;
  return isUsableCover(resolved.bytes) ? resolved : null;
}
