// Synchronous, in-memory CBZ (comic book ZIP) metadata + cover extractor.
// CBZ has no embedded metadata: title = filename, cover = first image.

import { unzipSync } from "fflate";
import type { BookCover, BookMetadata } from "./types";
import { extOf, mimeForExt } from "./shared";
import { MAX_COVER_BYTES } from "./cover";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "avif"]);

const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * Parse CBZ cover from raw bytes. Title is always the fallbackTitle (comic
 * archives carry no metadata). Never throws.
 */
export function parseCbz(bytes: Uint8Array, fallbackTitle: string): BookMetadata {
  const fallback: BookMetadata = { title: fallbackTitle, authors: "" };
  try {
    // Pass 1: index every page without inflating one. Returning `false` still
    // walks the central directory, so names and sizes are free.
    const pages: { name: string; originalSize: number }[] = [];
    unzipSync(bytes, {
      filter: (f) => {
        if (IMAGE_EXTS.has(extOf(f.name))) {
          pages.push({ name: f.name, originalSize: f.originalSize });
        }
        return false;
      },
    });
    if (pages.length === 0) return fallback;

    pages.sort((a, b) => collator.compare(a.name, b.name));
    const first = pages[0]!;
    if (first.originalSize > MAX_COVER_BYTES) return fallback;

    // Pass 2: inflate exactly the first page.
    const data = unzipSync(bytes, { filter: (f) => f.name === first.name })[first.name];
    // `originalSize` is the archive's own claim; re-check the actual bytes since
    // a crafted zip can understate it and covers are written outside the quota.
    if (!data || data.length === 0 || data.length > MAX_COVER_BYTES) return fallback;

    const ext = extOf(first.name) === "jpeg" ? "jpg" : extOf(first.name);
    const cover: BookCover = { bytes: data, mime: mimeForExt(ext), ext };
    return { title: fallbackTitle, authors: "", cover };
  } catch {
    return fallback;
  }
}
