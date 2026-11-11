import { useEffect } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { enhancedAuthFetch } from "@/api/queryFetch";
import { useDebounce } from "../useDebounce";
import { nextOffset, uniqueBooks } from "@/utils/discoveryPagination";
import type { HiveBook } from "../../../src/types";

export const useLanguages = () => {
  return useQuery({
    queryKey: ["languages"] as const,
    queryFn: async () => {
      const result = await enhancedAuthFetch<{ languages: string[] }>(
        `/xrpc/buzz.bookhive.getLanguages`,
      );
      return result?.languages ?? [];
    },
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 48 * 60 * 60 * 1000,
  });
};

export const useSearchBooks = (query: string, language?: string | null) => {
  const client = useQueryClient();
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebounce(normalizedQuery, 300);
  const isDebouncing = normalizedQuery !== debouncedQuery;
  useEffect(() => {
    if (isDebouncing) {
      void client.cancelQueries({
        queryKey: ["searchBooks", "infinite", debouncedQuery, language ?? ""],
        exact: true,
      });
    }
  }, [client, isDebouncing, debouncedQuery, language]);
  const result = useInfiniteQuery({
    queryKey: ["searchBooks", "infinite", debouncedQuery, language ?? ""] as const,
    initialPageParam: 0,
    queryFn: async ({ queryKey: [, , q, lang], pageParam, signal }) => {
      let url = `/xrpc/buzz.bookhive.searchBooks?q=${encodeURIComponent(q)}&limit=25&offset=${pageParam}`;
      if (lang) url += `&language=${encodeURIComponent(lang)}`;
      return await enhancedAuthFetch<{ books: HiveBook[]; offset?: number }>(url, { signal });
    },
    getNextPageParam: (page, _pages, offset) => nextOffset(page, offset, 25),
    enabled: Boolean(debouncedQuery) && !isDebouncing,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  // Book pickers consume an array, while Search also consumes pagination.
  return {
    ...result,
    data:
      normalizedQuery && !isDebouncing && result.data ? uniqueBooks(result.data.pages) : undefined,
    isLoading: Boolean(normalizedQuery) && (isDebouncing || result.isLoading),
    isDebouncing,
  };
};

export const useExplore = (language?: string | null, showDirectory = false) => {
  // listGenres has no language parameter; featured selections do.
  const genreDirectory = useInfiniteQuery({
    queryKey: ["explore", "genreDirectory"] as const,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      enhancedAuthFetch<{
        genres: { genre: string; count: number }[];
        offset: number;
      }>(`/xrpc/buzz.bookhive.listGenres?limit=50&offset=${pageParam}`, { signal }),
    getNextPageParam: (page, _pages, offset) =>
      nextOffset({ books: page.genres, offset: page.offset }, offset, 50),
    enabled: showDirectory,
    staleTime: 10 * 60 * 1000,
  });
  const explore = useQuery({
    queryKey: ["explore", language ?? ""] as const,
    queryFn: async ({ queryKey: [, lang], signal }) => {
      let url = `/xrpc/buzz.bookhive.getExplore`;
      if (lang) url += `?language=${encodeURIComponent(lang)}`;
      return await enhancedAuthFetch<{
        genres: { genre: string; count: number }[];
        topAuthors: { author: string; bookCount: number; thumbnail?: string; avgRating?: number }[];
      }>(url, { signal });
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return { ...explore, genreDirectory };
};

export const useAuthorBooks = (author: string, language?: string | null) => {
  return useInfiniteQuery({
    queryKey: ["authorBooks", "infinite", author, language ?? ""] as const,
    initialPageParam: 1,
    queryFn: async ({ queryKey: [, , a, lang], pageParam, signal }) => {
      let url = `/xrpc/buzz.bookhive.getAuthorBooks?author=${encodeURIComponent(a)}&page=${pageParam}`;
      if (lang) url += `&language=${encodeURIComponent(String(lang))}`;
      return await enhancedAuthFetch<{
        author: string;
        books: {
          id: string;
          title: string;
          authors: string;
          thumbnail?: string;
          cover?: string;
          rating?: number;
          ratingsCount?: number;
        }[];
        totalBooks: number;
        totalPages: number;
        page: number;
      }>(url, { signal });
    },
    getNextPageParam: (page) => (page.page < page.totalPages ? page.page + 1 : undefined),
    enabled: Boolean(author),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const useGenreBooks = (genre: string, language?: string | null) => {
  return useInfiniteQuery({
    queryKey: ["genreBooks", "infinite", genre, language ?? ""] as const,
    initialPageParam: 0,
    queryFn: ({ queryKey: [, , g, lang], pageParam, signal }) => {
      let url = `/xrpc/buzz.bookhive.searchBooks?genre=${encodeURIComponent(g)}&limit=50&offset=${pageParam}`;
      if (lang) url += `&language=${encodeURIComponent(lang)}`;
      return enhancedAuthFetch<{ books: HiveBook[]; offset?: number }>(url, { signal });
    },
    getNextPageParam: (page, _pages, offset) => nextOffset(page, offset, 50),
    enabled: Boolean(genre),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};
