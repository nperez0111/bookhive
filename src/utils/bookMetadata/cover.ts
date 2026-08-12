// Cover validation and normalization.
//
// A book can advertise a cover that is missing, undecodable (garbage bytes), or
// nonsensical (e.g. a 1x1 transparent placeholder). Any of those render as a
// blank box in the library grid, so we validate the extracted cover before
// storing it and fall back to a generated placeholder when it doesn't hold up.

import { imageMeta } from "image-meta";
import { Resvg } from "@resvg/resvg-js";
import type { BookCover } from "./types";
import { mimeForExt } from "./shared";

/** Minimum width/height (px) for a cover to be considered "real". */
export const MIN_COVER_DIMENSION = 16;

/**
 * Largest cover we will decompress out of an archive. The ZIP central
 * directory tells us the decompressed size before we inflate anything, so this
 * is checked ahead of the work rather than after it — a book advertising a
 * 200 MB image as its cover simply doesn't get one.
 */
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

/**
 * Width we rasterize an SVG cover to. The largest a cover is ever displayed is
 * ~300 CSS px (the book detail page), so 700 covers a 2x screen with room to
 * spare. It is also the memory and latency bound on the raster: `resvg` renders
 * synchronously into an RGBA buffer, so the cost is `width x height x 4` and
 * scales with the square of this number — 700 measured ~0.5s against ~2.4s at
 * 1400, for an output no one can tell apart.
 */
const SVG_RASTER_WIDTH = 700;

/** Quality for the JPEG we transcode a rasterized SVG to. */
const SVG_JPEG_QUALITY = 82;

function looksLikeSvg(bytes: Uint8Array): boolean {
  // Sniff rather than trust the extension: `mimeForExt` is driven by the name
  // inside the archive, and the manifest can lie. Only the first bytes matter —
  // an XML declaration and/or a comment may precede the root element.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 1024));
  return /<svg[\s>]/i.test(head);
}

/**
 * Turn an SVG cover into a raster one, or return null if it can't be rendered.
 *
 * This exists because **an SVG cover is not a wrapper around an image** — it is
 * a composition. Standard Ebooks, which is one of the largest sources of
 * public-domain EPUBs, ships every cover as an SVG holding the artwork in an
 * `<image>` element *plus* the title and author as ~40 vector `<path>`s over a
 * translucent band. Pulling the embedded raster back out (which is tempting,
 * and was tried) silently drops the title and author; rendering only the vector
 * layer (which is what `@takumi-rs` does — it ignores the embedded `<image>`)
 * drops the artwork. Only a real SVG renderer produces the actual cover.
 *
 * The output is JPEG rather than WebP deliberately: these covers are served to
 * OPDS clients and e-readers whose format support is unreliable and unknowable,
 * and JPEG is the one format all of them read. It costs ~2x the bytes of WebP
 * (75 KB vs 33 KB on a measured Standard Ebooks cover) against a PNG straight
 * out of `resvg` that would have been 1.1 MB.
 */
async function rasterizeSvgCover(bytes: Uint8Array): Promise<BookCover | null> {
  try {
    // `resvg` renders synchronously on this thread. The work is bounded by
    // MAX_COVER_BYTES on the way in and SVG_RASTER_WIDTH on the way out, and it
    // runs inside the upload core's parse semaphore, so at most
    // UPLOAD_PARSE_CONCURRENCY of these can be in flight per process.
    const png = new Resvg(Buffer.from(bytes), {
      fitTo: { mode: "width", value: SVG_RASTER_WIDTH },
      // A cover with transparency would otherwise flatten to black once we
      // encode to JPEG, which has no alpha channel.
      background: "white",
      // Don't rescan the host font database on every instance — resvg-js does
      // that per-`Resvg` and it is slow. These covers carry their text as
      // outlined vector `<path>`s (Standard Ebooks), so no fonts are needed; an
      // SVG that relied on live `<text>` would supply them via `fontFiles` here.
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
 * image pipeline, which rejects SVG outright as an "unrecognised format" — that
 * is what made every Standard Ebooks upload land with no cover at all. The two
 * agree exactly on every raster format; `image-meta` just knows more of them.
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
