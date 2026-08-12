import type { ImageSourcePropType } from "react-native";

import { getAuthState, getBaseUrl } from "@/context/auth";

/**
 * Resolve a `personalBookView.coverUrl` to something `<Image>` can load.
 *
 * The server returns one of two things: an absolute URL for a linked catalog
 * cover (routed through the image proxy so it gets resized and cached), or the
 * relative `/library/covers/{hash}` path for a cover extracted from the user's
 * own file. The latter is session-authenticated, and React Native's image
 * loader doesn't share the fetch client's cookie jar, so the `sid` cookie has
 * to be attached to the request explicitly.
 */
export function personalCoverSource(
  coverUrl: string | undefined,
  width = 300,
): ImageSourcePropType | undefined {
  if (!coverUrl) return undefined;
  if (coverUrl.startsWith("/")) {
    return {
      uri: `${getBaseUrl()}${coverUrl}`,
      headers: { cookie: `sid=${getAuthState()?.sid ?? ""}` },
    };
  }
  return {
    uri: `${getBaseUrl()}/images/s_${width}x${Math.round(width * 1.5)},fit_cover/${coverUrl}`,
  };
}

/**
 * Human-readable byte count at quota scale, e.g. "1.2 GB".
 *
 * Deliberately a byte-for-byte port of `formatBytes` in `src/routes/library.tsx`
 * and `src/client/components/LibraryManager.tsx`: the server bakes this exact
 * rendering into the 413 body it sends when an upload busts the quota, and the
 * app shows that message verbatim. If the two round differently, the alert and
 * the meter directly under it disagree about how full the library is.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Human-readable file size, e.g. "2.4 MB". */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Render a stored author string as a comma list.
 *
 * `personal_book.authors` is not consistently tab-separated, despite what the
 * lexicon description says: `parseBook` joins the ebook's own creators with
 * `", "`, while `linkPersonalBook` overwrites the column with `hive_book.authors`,
 * which is tab-separated. Splitting on tab handles the linked case and leaves the
 * parsed case alone — it is already a comma list. Do **not** also split on comma
 * to "fix" the parsed case: EPUB `dc:creator` is frequently "Last, First", and
 * that would turn one author into two.
 */
export function formatAuthors(authors: string | null | undefined): string {
  return (authors ?? "").split("\t").filter(Boolean).join(", ");
}

/** Percentages arrive as decimal strings ("0.42") from KOSync. */
export function progressFraction(percentage: string | number | undefined): number {
  const value = typeof percentage === "string" ? parseFloat(percentage) : (percentage ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
