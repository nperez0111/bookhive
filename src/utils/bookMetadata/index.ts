// Format-dispatching book metadata extraction.
//
// parseBook() detects the format from magic bytes + filename extension and
// routes to the appropriate per-format parser. Every parser is defensive and
// never throws: on failure it returns { title: fallback, authors: "" }.

import type { BookMetadata } from "./types";
import { extOf, looksLikeZip } from "./shared";
import { parseEpub } from "./epub";
import { isMOBI, parseMobi } from "./mobi";
import { parseFb2 } from "./fb2";
import { parseCbz } from "./cbz";

export type BookFormat = "epub" | "mobi" | "fb2" | "cbz" | "unknown";

export interface FormatInfo {
  format: BookFormat;
  /** Canonical file extension to store the book under (no dot). */
  ext: string;
  /** MIME type to serve the book with. */
  mime: string;
}

const FORMAT_MIME: Record<Exclude<BookFormat, "unknown">, string> = {
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  fb2: "application/x-fictionbook+xml",
  cbz: "application/vnd.comicbook+zip",
};

/** Accepted upload extensions -> canonical format. */
const EXT_FORMAT: Record<string, BookFormat> = {
  epub: "epub",
  mobi: "mobi",
  azw: "mobi",
  azw3: "mobi",
  fb2: "fb2",
  cbz: "cbz",
};

/** File extensions accepted by the uploader (for the accept="" attribute). */
export const ACCEPTED_EXTENSIONS = [".epub", ".mobi", ".azw", ".azw3", ".fb2", ".fb2.zip", ".cbz"];

/**
 * Determine the book format from filename + magic bytes. `.fb2.zip` is handled
 * as FB2. Returns "unknown" if we can't recognise it (upload should reject).
 */
export function detectFormat(bytes: Uint8Array, filename: string): FormatInfo {
  const lower = filename.toLowerCase();
  const isZip = looksLikeZip(bytes);
  const head = new TextDecoder().decode(bytes.subarray(0, 512));
  const looksLikeFb2Xml = /<\s*FictionBook/i.test(head);

  const unknown = (ext: string): FormatInfo => ({
    format: "unknown",
    ext: ext || "bin",
    mime: "application/octet-stream",
  });

  // Special-case the double extension .fb2.zip: must actually be a zip.
  if (lower.endsWith(".fb2.zip")) {
    if (!isZip) return unknown("fb2.zip");
    return { format: "fb2", ext: "fb2.zip", mime: FORMAT_MIME.fb2 };
  }

  const ext = extOf(filename);
  const claimed: BookFormat = EXT_FORMAT[ext] ?? "unknown";

  // Validate the claimed (extension-based) format against the actual content so
  // that a file merely *named* `.epub` etc. can't slip through. Only accept the
  // extension when the bytes are consistent with that format.
  switch (claimed) {
    case "epub":
    case "cbz":
      // Both are zip containers.
      if (isZip) return { format: claimed, ext: claimed, mime: FORMAT_MIME[claimed] };
      return unknown(ext);
    case "mobi":
      // Trust .mobi/.azw/.azw3 if it has the PDB/MOBI magic; PDB files that
      // aren't obviously something else are still accepted (defensive parse).
      if (isMOBI(bytes) || (!isZip && !looksLikeFb2Xml)) {
        return { format: "mobi", ext: "mobi", mime: FORMAT_MIME.mobi };
      }
      return unknown(ext);
    case "fb2":
      // Raw .fb2 must be XML that mentions FictionBook.
      if (looksLikeFb2Xml) return { format: "fb2", ext: "fb2", mime: FORMAT_MIME.fb2 };
      return unknown(ext);
  }

  // No usable extension: sniff by content.
  if (isMOBI(bytes)) return { format: "mobi", ext: "mobi", mime: FORMAT_MIME.mobi };
  if (looksLikeFb2Xml) return { format: "fb2", ext: "fb2", mime: FORMAT_MIME.fb2 };
  if (isZip) return { format: "epub", ext: "epub", mime: FORMAT_MIME.epub };

  return unknown(ext);
}

/**
 * Parse metadata for any supported format. Never throws.
 *
 * `formatInfo` is optional purely to save re-deriving it: the upload path
 * already ran `detectFormat` against a 4 KB head to decide whether to accept
 * the file at all, and re-running it here would be the only reason that call
 * needed the full buffer.
 */
export function parseBook(
  bytes: Uint8Array,
  filename: string,
  formatInfo?: FormatInfo,
): BookMetadata {
  const fallbackTitle = filename.replace(/\.[^.]+$/, "");
  const { format } = formatInfo ?? detectFormat(bytes, filename);
  switch (format) {
    case "epub":
      return parseEpub(bytes, fallbackTitle);
    case "mobi":
      return parseMobi(bytes, fallbackTitle);
    case "fb2":
      return parseFb2(bytes, fallbackTitle);
    case "cbz":
      return parseCbz(bytes, fallbackTitle);
    default:
      return { title: fallbackTitle, authors: "" };
  }
}

export { koreaderPartialMD5, koreaderPartialMD5File } from "./hash";
export { looksLikeZip } from "./shared";
export { parseEpub } from "./epub";
export { isUsableCover, prepareCover, MAX_COVER_BYTES, MIN_COVER_DIMENSION } from "./cover";
export type { BookCover, BookMetadata, EpubCover, EpubMetadata } from "./types";
