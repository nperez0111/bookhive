// Synchronous, in-memory CBZ (comic book ZIP) metadata + cover extractor.
// CBZ has no embedded metadata: title = filename, cover = first image.

import { unzipSync } from "fflate";
import type { BookCover, BookMetadata } from "./types";
import { extOf, mimeForExt } from "./shared";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "avif"]);

const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * Parse CBZ cover from raw bytes. Title is always the fallbackTitle (comic
 * archives carry no metadata). Never throws.
 */
export function parseCbz(bytes: Uint8Array, fallbackTitle: string): BookMetadata {
  const fallback: BookMetadata = { title: fallbackTitle, authors: "" };
  try {
    const files = unzipSync(bytes, {
      filter: (f) => IMAGE_EXTS.has(extOf(f.name)),
    });
    const names = Object.keys(files).sort((a, b) => collator.compare(a, b));
    if (names.length === 0) return fallback;

    const first = names[0];
    if (!first) return fallback;
    const ext = extOf(first) === "jpeg" ? "jpg" : extOf(first);
    const cover: BookCover = {
      bytes: files[first]!,
      mime: mimeForExt(ext),
      ext,
    };
    return { title: fallbackTitle, authors: "", cover };
  } catch {
    return fallback;
  }
}
