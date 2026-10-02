/**
 * The one canonical, transport-safe name for a stored ebook.
 *
 * Used in two places that must agree, because a client will take the name from
 * whichever of them it understands: the last path segment of the download URL,
 * and the plain `filename` parameter of `Content-Disposition`. A reader that
 * parses neither `filename*` nor a query string still ends up with the same
 * file on disk as one that parses both.
 *
 * Deliberately *not* used for `filename*`, which carries the user's real
 * filename with its accents and non-Latin scripts intact — that parameter
 * exists precisely so the lossy form doesn't have to be the only one.
 */

/** Longest stem we will emit, before the extension. */
const MAX_STEM_LENGTH = 80;

/**
 * Extensions that are really two segments. Splitting `.fb2.zip` at the last dot
 * would leave `Book.fb2` as the stem and then append the canonical extension to
 * it, producing `Book.fb2.fb2`.
 */
const COMPOUND_EXTENSIONS = [".fb2.zip"];

/** Strip a known ebook extension off a filename, returning the stem. */
function stemOf(filename: string): string {
  const lower = filename.toLowerCase();
  for (const compound of COMPOUND_EXTENSIONS) {
    if (lower.endsWith(compound)) return filename.slice(0, -compound.length);
  }
  const dot = filename.lastIndexOf(".");
  // Only treat a trailing dot group as an extension if it looks like one — a
  // title like "Vol. 2" must not lose its last word.
  if (dot > 0 && /^\.[A-Za-z0-9]{1,5}$/.test(filename.slice(dot))) {
    return filename.slice(0, dot);
  }
  return filename;
}

/**
 * Reduce a stem to `[A-Za-z0-9._-]`, which needs no percent-encoding in a path
 * segment and no escaping inside a quoted-string.
 *
 * Latin text keeps its letters by way of an NFD decomposition that drops the
 * combining marks (`Beloved Amrán` → `Beloved_Amran`). Scripts with no ASCII
 * form at all — Cyrillic, CJK — legitimately reduce to nothing here, and the
 * caller falls back to a generic stem rather than emitting a row of
 * underscores.
 */
function asciiStem(stem: string): string {
  return (
    stem
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, MAX_STEM_LENGTH)
      // Slicing can re-expose a trailing separator.
      .replace(/[._-]+$/, "")
  );
}

/**
 * The user's own filename with its extension swapped for `ext`.
 *
 * Unlike `canonicalDownloadFilename` this keeps the stem exactly as uploaded —
 * accents, non-Latin scripts and all — because it feeds `Content-Disposition`'s
 * `filename*`, whose entire purpose is to carry the real name. Used when the
 * bytes we serve are a *converted* representation, so the extension has to
 * change while the title must not.
 */
export function withExtension(
  filename: string | null | undefined,
  ext: string | null | undefined,
): string {
  const safeExt = (ext || "epub").replace(/[^A-Za-z0-9]/g, "") || "epub";
  const stem = stemOf(filename || "").trim();
  return `${stem || "book"}.${safeExt}`;
}

/**
 * Canonical download filename: an ASCII stem derived from what the user
 * uploaded, plus the extension the format actually is.
 *
 * The extension comes from `personal_book.format` rather than from the original
 * filename because the format was established from magic bytes at upload time,
 * and it is what decides the `Content-Type` we serve.
 */
export function canonicalDownloadFilename(
  filename: string | null | undefined,
  format: string | null | undefined,
): string {
  const ext = (format || "epub").replace(/[^A-Za-z0-9]/g, "") || "epub";
  const stem = asciiStem(stemOf(filename || ""));
  return `${stem || "book"}.${ext}`;
}
