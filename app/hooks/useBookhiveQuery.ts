import { authFetch } from "@/context/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HiveBook,
  HiveId,
  GetBook,
  GetProfile,
  UserBook,
} from "../../src/types";
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

export const useSearchBooks = (query: string) => {
  const debouncedQuery = useDebounce(query, 300);

  return useQuery({
    queryKey: ["searchBooks", query] as const,
    queryFn: async ({ queryKey: [, q] }) => {
      return await enhancedAuthFetch<HiveBook[]>(
        `/xrpc/buzz.bookhive.searchBooks?q=${q}`,
      );
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
      return await enhancedAuthFetch<GetBook.OutputSchema>(
        `/xrpc/buzz.bookhive.getBook?id=${hiveId}`,
      );
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
    queryFn: async ({ queryKey: [, id] }) => {
      return await enhancedAuthFetch<GetProfile.OutputSchema>(
        `/xrpc/buzz.bookhive.getProfile?did=${id || ""}`,
      );
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
      return await enhancedAuthFetch<{ success: boolean; message: string }>(
        `/api/update-book`,
        {
          method: "POST",
          body: {
            hiveId,
            ...rest,
          },
        },
      );
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
      return await enhancedAuthFetch<{ success: boolean; message: string }>(
        `/api/update-comment`,
        {
          method: "POST",
          body: {
            uri,
            hiveId,
            comment,
            parentUri,
            parentCid,
          },
        },
      );
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
      return await enhancedAuthFetch<{ success: boolean; bookId: string }>(
        `/books/${hiveId}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
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
