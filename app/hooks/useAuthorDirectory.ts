import { useEffect } from "react";
import { useDebounce } from "./useDebounce";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/context/auth";
import type { BuzzBookhiveListAuthors } from "../../src/bsky/lexicon/generated";

/** The same bounded top-500 directory as the web, not whole-catalogue author search. */
export function useAuthorDirectory(query: string, language?: string | null, enabled = true) {
  const client = useQueryClient();
  const normalized = query.toLowerCase().trim();
  const debounced = useDebounce(normalized, 300);
  const isDebouncing = normalized !== debounced;
  const queryKey = ["authorDirectory", language ?? "", debounced] as const;

  useEffect(() => {
    if (isDebouncing || !enabled) {
      void client.cancelQueries({
        queryKey: ["authorDirectory", language ?? "", debounced],
        exact: true,
      });
    }
  }, [client, language, debounced, isDebouncing, enabled]);

  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    enabled: enabled && !isDebouncing,
    queryFn: ({ queryKey: [, lang, q], pageParam, signal }) => {
      let url = `/xrpc/buzz.bookhive.listAuthors?limit=50&offset=${pageParam}`;
      if (lang) url += `&language=${encodeURIComponent(lang)}`;
      if (q) url += `&q=${encodeURIComponent(q)}`;
      return authFetch<BuzzBookhiveListAuthors.$output>(url, { signal });
    },
    getNextPageParam: (page, _pages, offset) =>
      page.hasMore && page.offset > offset && page.offset <= page.directoryLimit
        ? page.offset
        : undefined,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  const seen = new Set<string>();
  const authors = isDebouncing
    ? []
    : (result.data?.pages.flatMap((page) => page.authors) ?? []).filter((author) => {
        if (seen.has(author.author)) return false;
        seen.add(author.author);
        return true;
      });
  return {
    ...result,
    authors,
    total: isDebouncing ? undefined : result.data?.pages[0]?.total,
    isDebouncing,
    isLoading: enabled && (isDebouncing || result.isLoading),
  };
}
