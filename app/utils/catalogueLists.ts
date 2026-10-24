import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Public catalogue lists use AT URIs, never personal ebook shelf IDs. */
export function parseListTags(value: string): string[] {
  const tags = [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.some((tag) => Array.from(tag).length > 50)) {
    throw new Error("Each tag must be 50 characters or fewer.");
  }
  return tags;
}

export function listFormInput(name: string, description: string, ordered: boolean, tags: string) {
  const trimmedName = name.trim();
  if (!trimmedName || Array.from(trimmedName).length > 100) {
    throw new Error("Choose a list name between 1 and 100 characters.");
  }
  const trimmedDescription = description.trim();
  if (Array.from(trimmedDescription).length > 500) {
    throw new Error("Description must be 500 characters or fewer.");
  }
  // An empty string clears an existing description; undefined would preserve it.
  return { name: trimmedName, description: trimmedDescription, ordered, tags: parseListTags(tags) };
}

export function moveListItem<T extends { uri: string }>(
  items: T[],
  uri: string,
  offset: -1 | 1,
): T[] {
  const index = items.findIndex((item) => item.uri === uri);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function restoreListSnapshots(
  client: Pick<QueryClient, "setQueryData">,
  snapshots: [QueryKey, unknown][],
) {
  for (const [key, data] of snapshots) {
    client.setQueryData(key, data);
  }
}

/** Router params may already be decoded; malformed percent escapes must not crash a screen. */
export function catalogueListUri(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  let uri = raw;
  if (!raw.startsWith("at://")) {
    try {
      uri = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return /^at:\/\/[^/]+\/social\.popfeed\.feed\.list\/[^/]+$/.test(uri) ? uri : undefined;
}
