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

/** Human-readable file size, e.g. "2.4 MB". */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Authors are stored tab-separated throughout BookHive. */
export function formatAuthors(authors: string | null | undefined): string {
  return (authors ?? "").split("\t").filter(Boolean).join(", ");
}

/** Percentages arrive as decimal strings ("0.42") from KOSync. */
export function progressFraction(percentage: string | number | undefined): number {
  const value = typeof percentage === "string" ? parseFloat(percentage) : (percentage ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
