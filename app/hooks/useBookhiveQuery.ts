import { authFetch } from "@/context/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HiveBook, HiveId, GetBook, GetProfile, UserBook } from "../../src/types";
import { useEffect, useState } from "react";
import { classifyNetworkError } from "@/utils/networkErrorHandler";

const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Enhanced fetch function with better error handling
const enhancedAuthFetch = async <T>(url: string, options?: any): Promise<T> => {
  try {
    const response = await authFetch<T>(url, options);
    return response;
  } catch (error: any) {
    // Classify the error for better handling
    const networkError = classifyNetworkError(error);

    // Re-throw with enhanced error information
    const enhancedError = new Error(networkError.message);
    (enhancedError as any).networkError = networkError;
    (enhancedError as any).originalError = error;
    throw enhancedError;
  }
};

type SearchBooksResponse = { books: HiveBook[]; offset?: number };

export const useSearchBooks = (query: string) => {
  const debouncedQuery = useDebounce(query, 300);

  return useQuery({
    queryKey: ["searchBooks", query] as const,
    queryFn: async ({ queryKey: [, q] }) => {
      const result = await enhancedAuthFetch<{ books: HiveBook[] }>(
        `/xrpc/buzz.bookhive.searchBooks?q=${q}`,
      );
      return result?.books ?? [];
    },
    enabled: Boolean(debouncedQuery),
    retry: (failureCount, error: any) => {
      // Don't retry if it's a non-retryable error
      if (error.networkError && !error.networkError.retryable) {
        return false;
      }
      // Retry up to 3 times for retryable errors
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

/**
 * Get a book by its ID
 * @param id If undefined, the query will not be enabled
 * @returns
 */
export const useBookInfo = (id: HiveId | undefined | null) => {
  return useQuery({
    queryKey: ["getBook", id] as const,
    queryFn: async ({ queryKey: [, hiveId] }) => {
      return await enhancedAuthFetch<GetBook.$output>(`/xrpc/buzz.bookhive.getBook?id=${hiveId}`);
    },
    enabled: Boolean(id),
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
};

/**
 * Get a user's profile by their DID or handle
 * @param didOrHandle If undefined, the auth'd user's profile will be fetched
 * @returns
 */
export const useProfile = (did?: string) => {
  return useQuery({
    queryKey: ["profile", did] as const,
    queryFn: async ({ queryKey: [, id], client }) => {
      const data = await enhancedAuthFetch<GetProfile.$output>(
        `/xrpc/buzz.bookhive.getProfile?did=${id || ""}`,
      );
      // Invalidate all getBook queries when profile is fetched
      client.invalidateQueries({ queryKey: ["getBook"] });
      return data;
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
  });
};

/**
 * Follow a DID
 */
export const useFollow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ did }: { did: string }) => {
      return await enhancedAuthFetch<{ success: boolean }>(`/api/follow`, {
        method: "POST",
        body: { did },
      });
    },
    onSuccess: (_, { did }) => {
      queryClient.invalidateQueries({ queryKey: ["profile", did] });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

/**
 * Update the status of a book
 */
export const useUpdateBook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      hiveId,
      ...rest
    }: {
      hiveId: HiveId;
    } & Omit<
      Partial<UserBook>,
      "hiveId" | "uri" | "cid" | "userDid" | "indexedAt" | "createdAt"
    >) => {
      return await enhancedAuthFetch<{ success: boolean; message: string }>(`/api/update-book`, {
        method: "POST",
        body: {
          hiveId,
          ...rest,
        },
      });
    },
    onSuccess: (_, { hiveId }) => {
      // Invalidate the book query to refetch latest data
      queryClient.invalidateQueries({
        queryKey: ["getBook", hiveId],
      });
      queryClient.refetchQueries({
        queryKey: ["profile"],
      });
      queryClient.refetchQueries({
        queryKey: ["getBook", hiveId],
      });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) {
        return false;
      }
      return failureCount < 2; // Fewer retries for mutations
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

export const useUpdateComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      hiveId,
      comment,
      parentUri,
      parentCid,
      uri,
    }: {
      hiveId: HiveId;
      comment: string;
      parentUri: string;
      parentCid: string;
      uri?: string;
    }) => {
      return await enhancedAuthFetch<{ success: boolean; message: string }>(`/api/update-comment`, {
        method: "POST",
        body: {
          uri,
          hiveId,
          comment,
          parentUri,
          parentCid,
        },
      });
    },
    onSuccess: (_, { hiveId }) => {
      // Invalidate the book query to refetch latest data
      queryClient.invalidateQueries({
        queryKey: ["getBook", hiveId],
      });
      queryClient.invalidateQueries({
        queryKey: ["profile"],
      });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) {
        return false;
      }
      return failureCount < 2; // Fewer retries for mutations
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

/**
 * Delete a book from the user's library by HiveId
 */
export const useDeleteBook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ hiveId }: { hiveId: HiveId }) => {
      return await enhancedAuthFetch<{ success: boolean; hiveId: string }>(`/books/${hiveId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
    },
    onSuccess: (_, { hiveId }) => {
      // Invalidate and refetch book and profile data
      queryClient.invalidateQueries({ queryKey: ["getBook", hiveId] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

export const useExplore = () => {
  return useQuery({
    queryKey: ["explore"] as const,
    queryFn: async () => {
      return await enhancedAuthFetch<{
        genres: { genre: string; count: number }[];
        topAuthors: {
          author: string;
          bookCount: number;
          thumbnail?: string;
          avgRating?: number;
        }[];
      }>(`/xrpc/buzz.bookhive.getExplore`);
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const useFeed = (tab: "friends" | "all" | "tracking" = "friends", page: number = 1) => {
  return useQuery({
    queryKey: ["feed", tab, page] as const,
    queryFn: async ({ queryKey: [, t, p] }) => {
      return await enhancedAuthFetch<{
        activities: {
          userDid: string;
          userHandle?: string;
          hiveId: string;
          title: string;
          authors: string;
          status?: string;
          stars?: number;
          review?: string;
          createdAt: string;
          thumbnail: string;
          cover?: string;
        }[];
        hasMore: boolean;
        page: number;
      }>(`/xrpc/buzz.bookhive.getFeed?tab=${t}&page=${p}`);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

export const useAuthorBooks = (author: string, page: number = 1) => {
  return useQuery({
    queryKey: ["authorBooks", author, page] as const,
    queryFn: async ({ queryKey: [, a, p] }) => {
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
      }>(`/xrpc/buzz.bookhive.getAuthorBooks?author=${encodeURIComponent(String(a))}&page=${p}`);
    },
    enabled: Boolean(author),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

// ── Book Lists ──

export const useUserLists = (did?: string) => {
  return useQuery({
    queryKey: ["userLists", did] as const,
    queryFn: async ({ queryKey: [, d] }) => {
      return await enhancedAuthFetch<{
        lists: {
          uri: string;
          cid: string;
          userDid: string;
          userHandle?: string;
          name: string;
          description?: string;
          ordered?: boolean;
          tags?: string[];
          createdAt: string;
          itemCount?: number;
        }[];
      }>(`/xrpc/buzz.bookhive.getUserLists?did=${d}`);
    },
    enabled: Boolean(did),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useListDetails = (uri?: string) => {
  return useQuery({
    queryKey: ["listDetails", uri] as const,
    queryFn: async ({ queryKey: [, u] }) => {
      return await enhancedAuthFetch<{
        list: {
          uri: string;
          cid: string;
          userDid: string;
          userHandle?: string;
          name: string;
          description?: string;
          ordered?: boolean;
          tags?: string[];
          createdAt: string;
          itemCount?: number;
        };
        items: {
          uri: string;
          hiveId?: string;
          description?: string;
          position?: number;
          addedAt: string;
          title?: string;
          authors?: string;
          thumbnail?: string;
          cover?: string;
          rating?: number;
        }[];
      }>(`/xrpc/buzz.bookhive.getList?uri=${encodeURIComponent(String(u))}`);
    },
    enabled: Boolean(uri),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useCreateList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; ordered?: boolean }) => {
      return await enhancedAuthFetch<{ uri: string; cid: string }>(
        `/xrpc/buzz.bookhive.createList`,
        { method: "POST", body: input },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userLists"] });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) return false;
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

export const useUpdateList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      uri: string;
      name?: string;
      description?: string;
      ordered?: boolean;
    }) => {
      return await enhancedAuthFetch<{ uri: string; cid: string }>(
        `/xrpc/buzz.bookhive.updateList`,
        { method: "POST", body: input },
      );
    },
    onSuccess: (_, { uri }) => {
      queryClient.invalidateQueries({ queryKey: ["userLists"] });
      queryClient.invalidateQueries({ queryKey: ["listDetails", uri] });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) return false;
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

export const useDeleteList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uri }: { uri: string }) => {
      return await enhancedAuthFetch<{ success: boolean }>(`/xrpc/buzz.bookhive.deleteList`, {
        method: "POST",
        body: { uri },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userLists"] });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) return false;
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

export const useAddToList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { listUri: string; hiveId: string }) => {
      return await enhancedAuthFetch<{ uri: string }>(`/xrpc/buzz.bookhive.addToList`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: (_, { listUri }) => {
      queryClient.invalidateQueries({ queryKey: ["userLists"] });
      queryClient.invalidateQueries({ queryKey: ["listDetails", listUri] });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) return false;
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

export const useRemoveFromList = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemUri }: { itemUri: string }) => {
      return await enhancedAuthFetch<{ success: boolean }>(`/xrpc/buzz.bookhive.removeFromList`, {
        method: "POST",
        body: { itemUri },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userLists"] });
      queryClient.invalidateQueries({ queryKey: ["listDetails"] });
    },
    retry: (failureCount, error: any) => {
      if (error.networkError && !error.networkError.retryable) return false;
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
};

export const useReadingStats = (handle: string, year: number) => {
  return useQuery({
    queryKey: ["readingStats", handle, year] as const,
    queryFn: async ({ queryKey: [, h, y] }) => {
      return await enhancedAuthFetch<{
        stats: {
          booksCount: number;
          pagesRead: number;
          averageRating?: number;
          averagePageCount?: number;
          ratingDistribution: {
            one: number;
            two: number;
            three: number;
            four: number;
            five: number;
          };
          topGenres: { genre: string; count: number }[];
          shortestBook?: {
            hiveId: string;
            title: string;
            authors: string;
            cover?: string;
            thumbnail?: string;
            pageCount?: number;
          };
          longestBook?: {
            hiveId: string;
            title: string;
            authors: string;
            cover?: string;
            thumbnail?: string;
            pageCount?: number;
          };
          firstBookOfYear?: {
            hiveId: string;
            title: string;
            authors: string;
            cover?: string;
            thumbnail?: string;
          };
          lastBookOfYear?: {
            hiveId: string;
            title: string;
            authors: string;
            cover?: string;
            thumbnail?: string;
          };
          mostPopularBook?: {
            hiveId: string;
            title: string;
            authors: string;
            cover?: string;
            thumbnail?: string;
            rating?: number;
          };
          leastPopularBook?: {
            hiveId: string;
            title: string;
            authors: string;
            cover?: string;
            thumbnail?: string;
            rating?: number;
          };
        };
        availableYears: number[];
        year: number;
      }>(`/xrpc/buzz.bookhive.getReadingStats?handle=${encodeURIComponent(String(h))}&year=${y}`);
    },
    enabled: Boolean(handle),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};
