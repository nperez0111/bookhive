/**
 * Browser-only Libby/OverDrive Thunder API client. Adapted from the
 * MIT-licensed shelfcheck project (`nowells/libby-reading-list`,
 * `app/lib/libby.ts`). Drops the per-book live-availability refresh
 * (search-embedded availability is what we surface in v1) and the
 * Open Library alternate-edition ISBN fan-out (we already resolve
 * workIds server-side via `src/utils/openLibrary.ts`).
 */
import {
  contentWordsMatch as sharedContentWordsMatch,
  similarityScore as sharedSimilarityScore,
} from "../../utils/bookMatching";

const THUNDER_API_URL = "https://thunder.api.overdrive.com/v2";
const LOCATE_API_URL = "https://locate.libbyapp.com/autocomplete";

export const REFERENCE_LIBRARY = "lapl";

export type LibbyLibrary = {
  id: number;
  name: string;
  fulfillmentId: string;
  preferredKey?: string;
  type?: string;
  isConsortium?: boolean;
  logoUrl?: string;
};

export type LibbyMediaItem = {
  id: string;
  title: string;
  sortTitle?: string;
  subtitle?: string;
  type?: { id: string; name: string };
  formats?: Array<{ id: string; name: string; duration?: string }>;
  creators?: Array<{ name: string; role: string }>;
  covers?: { cover150Wide?: { href: string } };
  series?: string;
  detailedSeries?: { seriesName: string; readingOrder: string };
  firstCreatorSortName?: string;
  publisher?: { id: string; name: string };
  publishDate?: string;
  isAvailable?: boolean;
  ownedCopies?: number;
  availableCopies?: number;
  holdsCount?: number;
  estimatedWaitDays?: number;
};

export type AvailabilityInfo = {
  id: string;
  copiesOwned: number;
  copiesAvailable: number;
  numberOfHolds: number;
  isAvailable: boolean;
  estimatedWaitDays?: number;
};

export type BookAvailabilityResult = {
  mediaItem: LibbyMediaItem;
  availability: AvailabilityInfo;
  matchScore: number;
  formatType: string;
  libraryKey: string;
};

export type BookAvailability = {
  bookTitle: string;
  bookAuthor: string;
  coverUrl?: string;
  seriesInfo?: { seriesName: string; readingOrder: string };
  results: BookAvailabilityResult[];
};

const inflight = new Map<string, Promise<unknown>>();

async function thunderFetch<T>(path: string): Promise<T> {
  const url = `${THUNDER_API_URL}${path}`;
  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    const res = await fetch(url, { headers: { "x-client-id": "dewey" } });
    if (!res.ok) {
      throw new Error(`Libby API error: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  })().finally(() => {
    inflight.delete(url);
  });

  inflight.set(url, promise);
  return promise;
}

export async function searchLibrary(
  libraryKey: string,
  query: string,
  format?: "ebook" | "audiobook",
): Promise<LibbyMediaItem[]> {
  const params = new URLSearchParams({ query });
  if (format === "ebook") {
    params.set(
      "format",
      "ebook-kindle,ebook-overdrive,ebook-epub-adobe,ebook-epub-open,ebook-media-do",
    );
  } else if (format === "audiobook") {
    params.set("format", "audiobook-overdrive,audiobook-mp3");
  }
  const data = await thunderFetch<{ items?: LibbyMediaItem[] }>(
    `/libraries/${libraryKey}/media?${params.toString()}`,
  );
  return data.items ?? [];
}

async function getMediaItem(libraryKey: string, titleId: string): Promise<LibbyMediaItem | null> {
  try {
    return await thunderFetch<LibbyMediaItem>(`/libraries/${libraryKey}/media/${titleId}`);
  } catch {
    return null;
  }
}

export async function searchLibraryByName(query: string): Promise<LibbyLibrary[]> {
  const url = `${LOCATE_API_URL}/${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Libby locate API error: ${res.status}`);
  const data = (await res.json()) as {
    branches?: Array<{
      systems?: Array<{
        id: number;
        name: string;
        fulfillmentId: string;
        type?: string;
        isConsortium?: boolean;
        styling?: { logos?: Array<{ sourceUrl?: string }> };
      }>;
    }>;
  };

  const seen = new Set<number>();
  const libraries: LibbyLibrary[] = [];
  for (const branch of data.branches ?? []) {
    for (const system of branch.systems ?? []) {
      if (seen.has(system.id)) continue;
      seen.add(system.id);
      libraries.push({
        id: system.id,
        name: system.name,
        fulfillmentId: system.fulfillmentId,
        type: system.type,
        isConsortium: system.isConsortium,
        logoUrl: system.styling?.logos?.[0]?.sourceUrl,
      });
    }
  }
  return libraries;
}

export async function getLibraryPreferredKey(fulfillmentId: string): Promise<string> {
  const data = await thunderFetch<{ preferredKey?: string }>(`/libraries/${fulfillmentId}`);
  return data.preferredKey ?? fulfillmentId;
}

function availabilityFor(item: LibbyMediaItem): AvailabilityInfo {
  return {
    id: item.id,
    copiesOwned: item.ownedCopies ?? 0,
    copiesAvailable: item.availableCopies ?? 0,
    numberOfHolds: item.holdsCount ?? 0,
    isAvailable: item.isAvailable ?? (item.availableCopies ?? 0) > 0,
    estimatedWaitDays: item.estimatedWaitDays,
  };
}

function buildResult(
  libraryKey: string,
  item: LibbyMediaItem,
  matchScore: number,
): BookAvailabilityResult {
  return {
    mediaItem: item,
    availability: availabilityFor(item),
    matchScore,
    formatType: item.type?.id ?? "unknown",
    libraryKey,
  };
}

export type FindBookOptions = {
  primaryIsbn?: string | null;
};

export async function findBookInLibrary(
  libraryKey: string,
  title: string,
  author: string,
  options: FindBookOptions = {},
): Promise<BookAvailability> {
  const result: BookAvailability = {
    bookTitle: title,
    bookAuthor: author,
    results: [],
  };
  const seenIds = new Set<string>();

  async function tryIsbn(isbn: string) {
    try {
      const items = await searchLibrary(libraryKey, isbn);
      for (const item of items.slice(0, 3)) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        result.results.push(buildResult(libraryKey, item, 1));
      }
    } catch {
      /* fall through */
    }
  }

  // Phase 1: precise ISBN search.
  if (options.primaryIsbn) {
    await tryIsbn(options.primaryIsbn);
  }

  // Phase 2: text search fallback gated by contentWordsMatch.
  if (result.results.length === 0) {
    const queries = [
      `${author} ${title}`,
      title.includes(":") ? `${author} ${(title.split(":")[0] ?? title).trim()}` : null,
      title,
    ].filter(Boolean) as string[];

    for (const query of queries) {
      try {
        const items = await searchLibrary(libraryKey, query);
        for (const item of items.slice(0, 5)) {
          if (seenIds.has(item.id)) continue;
          const titleScore = sharedSimilarityScore(title, item.title);
          const authorName = item.creators?.find((c) => c.role === "Author")?.name ?? "";
          const authorScore = author ? sharedSimilarityScore(author, authorName) : 0.5;
          if (
            titleScore >= 0.4 &&
            authorScore >= 0.3 &&
            sharedContentWordsMatch(title, item.title)
          ) {
            seenIds.add(item.id);
            result.results.push(buildResult(libraryKey, item, (titleScore + authorScore) / 2));
          }
        }
      } catch {
        /* try next */
      }
      if (result.results.length > 0) break;
    }
  }

  // Phase 3: reference-library deep search → look up canonical title id
  // in a large library, then fetch that id from the user's library.
  if (result.results.length === 0 && libraryKey !== REFERENCE_LIBRARY) {
    try {
      const refItems = await searchLibrary(REFERENCE_LIBRARY, `${author} ${title}`);
      for (const item of refItems.slice(0, 5)) {
        if (seenIds.has(item.id)) continue;
        const titleScore = sharedSimilarityScore(title, item.title);
        const authorName = item.creators?.find((c) => c.role === "Author")?.name ?? "";
        const authorScore = author ? sharedSimilarityScore(author, authorName) : 0.5;
        if (titleScore >= 0.4 && authorScore >= 0.3 && sharedContentWordsMatch(title, item.title)) {
          seenIds.add(item.id);
          const localItem = await getMediaItem(libraryKey, item.id);
          if (!localItem) continue;
          result.results.push(buildResult(libraryKey, localItem, (titleScore + authorScore) / 2));
        }
      }
    } catch {
      /* deep search failed */
    }
  }

  result.results.sort((a, b) => b.matchScore - a.matchScore);

  for (const r of result.results) {
    const href = r.mediaItem.covers?.cover150Wide?.href;
    if (href && !result.coverUrl) result.coverUrl = href;
    const ds = r.mediaItem.detailedSeries;
    if (ds && !result.seriesInfo) result.seriesInfo = { ...ds };
    if (result.coverUrl && result.seriesInfo) break;
  }

  return result;
}

/**
 * Build the Libby app URL for a specific title. Mirrors the format the
 * Libby web app uses; opening this in a new tab lands the user on the
 * borrow page for that title in the named library.
 */
export function buildLibbyTitleUrl(libraryKey: string, titleId: string): string {
  return `https://libbyapp.com/library/${libraryKey}/page-1/${titleId}`;
}
