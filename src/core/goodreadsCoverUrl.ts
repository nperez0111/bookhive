/**
 * Repair the missing `._` before a Goodreads book-cover size suffix. Historical
 * catalogue rows contain e.g. `51256920SY75_.jpg`, which the CDN rejects with 403.
 * Keep valid thumbnails sized unless the scraper explicitly requests full size.
 * This is deliberately not a general URL sanitizer or a fallback for any 403.
 */
export function normalizeGoodreadsCoverUrl(
  source: string,
  { fullSize = false }: { fullSize?: boolean } = {},
): string {
  if (!/^https?:\/\//i.test(source)) return source;
  try {
    const url = new URL(source);
    if (url.hostname !== "i.gr-assets.com" || url.username || url.password) return source;
  } catch {
    return source;
  }

  // Work on the original path, not URL serialization: preserve query strings,
  // fragments, escapes and the authority byte-for-byte (including on no-ops).
  const parts = source.match(/^(https?:\/\/[^/?#]+)(\/[^?#]*)([?#][\s\S]*)?$/i);
  if (!parts) return source;
  const [, origin, pathname, tail = ""] = parts;
  const cover = pathname?.match(
    /^((?:\/images\/S\/compressed\.photo\.goodreads\.com)?\/books\/(?:\d+[a-z]\/)?\d+)(\._)?((?:SX|SY|UX|UY)\d+_)(\.jpe?g)$/,
  );
  if (!cover) return source;
  const [, bookPath, separator, size, extension] = cover;
  if (!fullSize && separator) return source;
  return `${origin}${bookPath}${fullSize ? "" : `._${size}`}${extension}${tail}`;
}
