import type { Storage } from "unstorage";
import { normalizeIsbn13, normalizeOlWorkId } from "./bookIdentifiers";
import { readThroughCache } from "./readThroughCache";

/**
 * Server-side OpenLibrary ISBN→workId lookup, KV-cached.
 *
 * Ported (loosely) from the MIT-licensed shelfcheck project's
 * `app/lib/openlibrary.ts`. Shelfcheck caches in browser localStorage; here
 * we go through `kvStore` so every server hit benefits the next request.
 */

const BASE = "https://openlibrary.org";
const KV_PREFIX = "bookhive:ol-isbn:";
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OpenLibraryEnrichment = {
  workId: string;
  canonicalTitle: string | null;
};

type OpenLibraryEditionResponse = {
  title?: string;
  works?: { key?: string }[];
};

/** Extract the workId (e.g. "OL45883W") from an Open Library edition JSON. */
export function parseEdition(payload: unknown): OpenLibraryEnrichment | null {
  if (!payload || typeof payload !== "object") return null;
  const ed = payload as OpenLibraryEditionResponse;
  const workKey = ed.works?.[0]?.key;
  if (typeof workKey !== "string") return null;
  const workId = normalizeOlWorkId(workKey);
  if (!workId) return null;
  const canonicalTitle =
    typeof ed.title === "string" && ed.title.trim().length > 0 ? ed.title.trim() : null;
  return { workId, canonicalTitle };
}

async function fetchByIsbn(isbn: string): Promise<OpenLibraryEnrichment | null> {
  try {
    const res = await fetch(`${BASE}/isbn/${isbn}.json`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const json = await res.json();
    return parseEdition(json);
  } catch {
    return null;
  }
}

/**
 * Look up an ISBN-10/13 on OpenLibrary and return its workId. Successful
 * responses (including a confirmed 404 → `null`) are cached for 30 days
 * via `readThroughCache`. Network/parse failures fall through without
 * polluting the cache so the next request can retry.
 */
export async function lookupIsbn(
  kv: Storage,
  isbnInput: string,
): Promise<OpenLibraryEnrichment | null> {
  const isbn = normalizeIsbn13(isbnInput);
  if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) return null;

  return readThroughCache<OpenLibraryEnrichment | null>(
    kv as Storage<OpenLibraryEnrichment | null>,
    `${KV_PREFIX}${isbn}`,
    () => fetchByIsbn(isbn),
    null,
    { ttl: POSITIVE_TTL_MS, requestsPerSecond: 5 },
  );
}
