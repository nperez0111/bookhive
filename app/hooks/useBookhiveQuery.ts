import { authFetch, getAuthState, getBaseUrl } from "@/context/auth";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export const useLanguages = () => {
  return useQuery({
    queryKey: ["languages"] as const,
    queryFn: async () => {
      const result = await enhancedAuthFetch<{ languages: string[] }>(
        `/xrpc/buzz.bookhive.getLanguages`,
      );
      return result?.languages ?? [];
    },
    staleTime: 24 * 60 * 60 * 1000, // 1 day
    gcTime: 48 * 60 * 60 * 1000, // 2 days
  });
};

export const useSearchBooks = (query: string, language?: string | null) => {
  const debouncedQuery = useDebounce(query, 300);

  return useQuery({
    queryKey: ["searchBooks", query, language ?? ""] as const,
    queryFn: async ({ queryKey: [, q, lang] }) => {
      let url = `/xrpc/buzz.bookhive.searchBooks?q=${encodeURIComponent(String(q))}`;
      if (lang) url += `&language=${encodeURIComponent(lang)}`;
      const result = await enhancedAuthFetch<{ books: HiveBook[] }>(url);
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
      void client.invalidateQueries({ queryKey: ["getBook"] });
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
    onMutate: async ({ did }) => {
      await queryClient.cancelQueries({ queryKey: ["profile", did] });
      const previousProfile = queryClient.getQueryData(["profile", did]);
      queryClient.setQueryData(["profile", did], (old: any) => {
        if (!old) return old;
        return { ...old, profile: { ...old.profile, isFollowing: true } };
      });
      return { previousProfile };
    },
    onError: (_err, { did }, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(["profile", did], context.previousProfile);
      }
    },
    onSettled: (_data, _error, { did }) => {
      void queryClient.invalidateQueries({ queryKey: ["profile", did] });
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
  type UpdateInput = {
    hiveId: HiveId;
  } & Omit<Partial<UserBook>, "hiveId" | "uri" | "cid" | "userDid" | "indexedAt" | "createdAt">;
  return useMutation({
    mutationFn: async ({ hiveId, ...rest }: UpdateInput) => {
      return await enhancedAuthFetch<{ success: boolean; message: string }>(`/api/update-book`, {
        method: "POST",
        body: {
          hiveId,
          ...rest,
        },
      });
    },
    onMutate: async ({ hiveId, ...updates }: UpdateInput) => {
      await queryClient.cancelQueries({ queryKey: ["getBook", hiveId] });
      const previousBook = queryClient.getQueryData(["getBook", hiveId]);
      queryClient.setQueryData(["getBook", hiveId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ...("status" in updates && { status: updates.status }),
          ...("owned" in updates && { owned: updates.owned ? true : undefined }),
          ...("stars" in updates && { stars: updates.stars }),
          ...("review" in updates && { review: updates.review }),
          ...("bookProgress" in updates && { bookProgress: updates.bookProgress }),
          ...("startedAt" in updates && { startedAt: updates.startedAt }),
          ...("finishedAt" in updates && { finishedAt: updates.finishedAt }),
        };
      });
      return { previousBook };
    },
    onError: (_err, { hiveId }, context) => {
      if (context?.previousBook) {
        queryClient.setQueryData(["getBook", hiveId], context.previousBook);
      }
    },
    onSettled: (_data, _error, { hiveId }) => {
      void queryClient.invalidateQueries({ queryKey: ["getBook", hiveId] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
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
      void queryClient.invalidateQueries({
        queryKey: ["getBook", hiveId],
      });
      void queryClient.invalidateQueries({
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
    onMutate: async ({ hiveId }) => {
      await queryClient.cancelQueries({ queryKey: ["getBook", hiveId] });
      const previousBook = queryClient.getQueryData(["getBook", hiveId]);
      queryClient.setQueryData(["getBook", hiveId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          status: undefined,
          stars: undefined,
          review: undefined,
          owned: undefined,
          bookProgress: undefined,
          startedAt: undefined,
          finishedAt: undefined,
        };
      });
      return { previousBook };
    },
    onError: (_err, { hiveId }, context) => {
      if (context?.previousBook) {
        queryClient.setQueryData(["getBook", hiveId], context.previousBook);
      }
    },
    onSettled: (_data, _error, { hiveId }) => {
      void queryClient.invalidateQueries({ queryKey: ["getBook", hiveId] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
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

export const useExplore = (language?: string | null) => {
  return useQuery({
    queryKey: ["explore", language ?? ""] as const,
    queryFn: async ({ queryKey: [, lang] }) => {
      let url = `/xrpc/buzz.bookhive.getExplore`;
      if (lang) url += `?language=${encodeURIComponent(lang)}`;
      return await enhancedAuthFetch<{
        genres: { genre: string; count: number }[];
        topAuthors: {
          author: string;
          bookCount: number;
          thumbnail?: string;
          avgRating?: number;
        }[];
      }>(url);
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
          hiveId?: string;
          uri: string;
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

export const useAuthorBooks = (author: string, page: number = 1, language?: string | null) => {
  return useQuery({
    queryKey: ["authorBooks", author, page, language ?? ""] as const,
    queryFn: async ({ queryKey: [, a, p, lang] }) => {
      let url = `/xrpc/buzz.bookhive.getAuthorBooks?author=${encodeURIComponent(String(a))}&page=${p}`;
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
      }>(url);
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
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
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
    onMutate: async ({ uri, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: ["listDetails", uri] });
      await queryClient.cancelQueries({ queryKey: ["userLists"] });
      const previousDetails = queryClient.getQueryData(["listDetails", uri]);
      const previousLists = queryClient.getQueryData(["userLists"]);
      queryClient.setQueryData(["listDetails", uri], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          list: {
            ...old.list,
            ...("name" in updates && { name: updates.name }),
            ...("description" in updates && { description: updates.description }),
            ...("ordered" in updates && { ordered: updates.ordered }),
          },
        };
      });
      queryClient.setQueriesData({ queryKey: ["userLists"] }, (old: any) => {
        if (!old?.lists) return old;
        return {
          ...old,
          lists: old.lists.map((l: any) =>
            l.uri === uri
              ? {
                  ...l,
                  ...("name" in updates && { name: updates.name }),
                  ...("description" in updates && { description: updates.description }),
                  ...("ordered" in updates && { ordered: updates.ordered }),
                }
              : l,
          ),
        };
      });
      return { previousDetails, previousLists };
    },
    onError: (_err, { uri }, context) => {
      if (context?.previousDetails) {
        queryClient.setQueryData(["listDetails", uri], context.previousDetails);
      }
      if (context?.previousLists) {
        queryClient.setQueriesData({ queryKey: ["userLists"] }, context.previousLists);
      }
    },
    onSettled: (_data, _error, { uri }) => {
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
      void queryClient.invalidateQueries({ queryKey: ["listDetails", uri] });
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
    onMutate: async ({ uri }) => {
      await queryClient.cancelQueries({ queryKey: ["userLists"] });
      const previousLists = queryClient.getQueryData(["userLists"]);
      queryClient.setQueriesData({ queryKey: ["userLists"] }, (old: any) => {
        if (!old?.lists) return old;
        return { ...old, lists: old.lists.filter((l: any) => l.uri !== uri) };
      });
      return { previousLists };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLists) {
        queryClient.setQueriesData({ queryKey: ["userLists"] }, context.previousLists);
      }
    },
    onSettled: (_data, _error, { uri }) => {
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
      void queryClient.invalidateQueries({ queryKey: ["listDetails", uri] });
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
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
      void queryClient.invalidateQueries({ queryKey: ["listDetails", listUri] });
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
    mutationFn: async ({ itemUri, listUri: _listUri }: { itemUri: string; listUri?: string }) => {
      return await enhancedAuthFetch<{ success: boolean }>(`/xrpc/buzz.bookhive.removeFromList`, {
        method: "POST",
        body: { itemUri },
      });
    },
    onMutate: async ({ itemUri, listUri }) => {
      if (!listUri) return {};
      await queryClient.cancelQueries({ queryKey: ["listDetails", listUri] });
      const previousDetails = queryClient.getQueryData(["listDetails", listUri]);
      queryClient.setQueryData(["listDetails", listUri], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((i: any) => i.uri !== itemUri),
          list: { ...old.list, itemCount: Math.max(0, (old.list.itemCount ?? 0) - 1) },
        };
      });
      return { previousDetails, listUri };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousDetails && context?.listUri) {
        queryClient.setQueryData(["listDetails", context.listUri], context.previousDetails);
      }
    },
    onSettled: (_data, _error, { listUri }) => {
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
      if (listUri) {
        void queryClient.invalidateQueries({ queryKey: ["listDetails", listUri] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["listDetails"] });
      }
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

// ── Personal Library & E-Reader Sync ──

/** A book file the user uploaded, as returned by `getPersonalLibrary`. */
export type PersonalBook = {
  contentHash: string;
  title: string;
  authors?: string;
  language?: string;
  format: string;
  mime: string;
  sizeBytes: number;
  coverUrl?: string;
  /**
   * Whether a cover was extracted from the uploaded file (as opposed to
   * `coverUrl` pointing at the public catalog image proxy). The app fetches
   * either form through `personalCoverSource`, which attaches the session
   * cookie for the local one; this is here because a service-auth client can't
   * use the local URL at all and has to go through `getPersonalBookCover`.
   */
  hasLocalCover?: boolean;
  hiveId?: string;
  /** Original uploaded file name — what the user sees on their e-reader. */
  filename?: string;
  /** Synopsis from the linked catalog entry. Absent until the book is linked. */
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Percentage arrives as a decimal string ("0.42") straight from KOSync. */
  progress?: { percentage: string; device?: string; updatedAt: string };
  shelfIds?: number[];
};

/**
 * Per-user storage usage against the quota, returned on every
 * `getPersonalLibrary` page rather than by a method of its own — the library
 * screen already refetches that after each mutation, so the meter stays honest
 * with no extra round-trip and no separate invalidation to keep in sync.
 */
export type PersonalStorage = {
  usedBytes: number;
  quotaBytes: number;
};

/** A user-defined shelf grouping personal library books. */
export type PersonalShelf = {
  id: number;
  name: string;
  description?: string;
  bookCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A document an e-reader has reported progress for. `hasFile` means an upload
 * shares its content hash, so the library grid already shows it; `dismissed`
 * means the user said it has no BookHive counterpart.
 */
export type SyncDoc = {
  document: string;
  title: string | null;
  authors: string | null;
  filename: string | null;
  percentage: number;
  device: string | null;
  updatedAt: string;
  hiveId: string | null;
  bookTitle: string | null;
  dismissed: boolean;
  hasFile: boolean;
};

const PERSONAL_LIBRARY_PAGE_SIZE = 24;

export const usePersonalLibrary = (shelfId?: number) => {
  return useInfiniteQuery({
    queryKey: ["personalLibrary", shelfId ?? null] as const,
    initialPageParam: "",
    queryFn: async ({ queryKey: [, shelf], pageParam }) => {
      let url = `/xrpc/buzz.bookhive.getPersonalLibrary?limit=${PERSONAL_LIBRARY_PAGE_SIZE}`;
      if (shelf != null) url += `&shelfId=${shelf}`;
      if (pageParam) url += `&cursor=${encodeURIComponent(pageParam)}`;
      return await enhancedAuthFetch<{
        books: PersonalBook[];
        total?: number;
        cursor?: string;
        storage?: PersonalStorage;
      }>(url);
    },
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

/**
 * Storage usage out of a `usePersonalLibrary` result.
 *
 * Reads the **last** page, not the first: every page carries a fresh `storage`,
 * and on a refetch React Query replays the pages in order, so the last one is
 * the most recently observed. Falling back to the first page covers the
 * single-page case and a paginated result whose tail hasn't loaded yet.
 */
export function storageFromLibrary(
  data: { pages: { storage?: PersonalStorage }[] } | undefined,
): PersonalStorage | null {
  if (!data?.pages.length) return null;
  return data.pages[data.pages.length - 1]?.storage ?? data.pages[0]?.storage ?? null;
}

export const usePersonalShelves = () => {
  return useQuery({
    queryKey: ["personalShelves"] as const,
    queryFn: async () => {
      const result = await enhancedAuthFetch<{ shelves: PersonalShelf[] }>(`/library/shelves`);
      return result?.shelves ?? [];
    },
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useSyncDocuments = () => {
  return useQuery({
    queryKey: ["syncDocuments"] as const,
    queryFn: async () => {
      const result = await enhancedAuthFetch<{ documents: SyncDoc[] }>(`/library/sync/documents`);
      return result?.documents ?? [];
    },
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useSyncPassword = () => {
  return useQuery({
    queryKey: ["syncPassword"] as const,
    queryFn: async () => {
      const result = await enhancedAuthFetch<{ password: string }>(`/settings/sync/password`);
      return result.password;
    },
    // Derived server-side from a rotation counter, so it only changes when the
    // user rotates it — no reason to refetch while the screen is open.
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  });
};

export const useRotateSyncPassword = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await enhancedAuthFetch<{ password: string }>(`/settings/sync/rotate`, {
        method: "POST",
      });
    },
    onSuccess: ({ password }) => {
      queryClient.setQueryData(["syncPassword"], password);
    },
    retry: false,
  });
};

/**
 * An upload the server refused for a reason it named.
 *
 * `code` is the server's closed set of upload failure codes (`TooLarge`,
 * `QuotaExceeded`, `UnsupportedFormat`, `AlreadyExists`, `EmptyFile`, `NoFile`,
 * `Busy`). `message` is the server's own prose, which is what the UI shows — the
 * code is for deciding what to do *besides* showing it, like refreshing the
 * storage meter after a quota rejection.
 */
export class UploadError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly usedBytes?: number;
  readonly quotaBytes?: number;

  constructor(
    message: string,
    init: { code?: string; status: number; usedBytes?: number; quotaBytes?: number },
  ) {
    super(message);
    this.name = "UploadError";
    this.code = init.code;
    this.status = init.status;
    this.usedBytes = init.usedBytes;
    this.quotaBytes = init.quotaBytes;
  }
}

/**
 * Multipart upload with real progress. Goes through XMLHttpRequest rather than
 * the shared fetch wrapper for two reasons: React Native streams a
 * `{ uri, name, type }` form part straight off disk (a 100 MB ebook never lands
 * in JS memory), and `upload.onprogress` is the only way to drive a determinate
 * progress bar.
 */
function uploadBookFile({
  uri,
  name,
  mime,
  onProgress,
}: {
  uri: string;
  name: string;
  mime?: string;
  onProgress?: (fraction: number) => void;
}): Promise<{ book: PersonalBook }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", {
      uri,
      name,
      type: mime || "application/octet-stream",
    } as unknown as Blob);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${getBaseUrl()}/library/upload`);
    xhr.setRequestHeader("accept", "application/json");
    xhr.setRequestHeader("cookie", `sid=${getAuthState()?.sid ?? ""}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      let payload: any = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        // Non-JSON body — fall through to the status-based message below.
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.book) {
        onProgress?.(1);
        resolve(payload as { book: PersonalBook });
        return;
      }
      reject(
        new UploadError(
          payload?.error ||
            (xhr.status === 401
              ? "Your session expired. Sign in again to upload."
              : `Upload failed (${xhr.status})`),
          {
            code: payload?.code,
            status: xhr.status,
            usedBytes: payload?.usedBytes,
            quotaBytes: payload?.quotaBytes,
          },
        ),
      );
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.timeout = 5 * 60_000;
    xhr.ontimeout = () =>
      reject(new Error("Upload timed out. Check your connection and try again."));

    xhr.send(form);
  });
}

export const useUploadPersonalBook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadBookFile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["personalLibrary"] });
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
      // An upload can adopt a synced document (same content hash), which moves
      // it out of the triage list and into the grid.
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error) => {
      // A rejection on these two codes means our copy of the library disagrees
      // with the server's: the quota bar is showing room that isn't there, or
      // the grid is missing a book that already exists. Both are worth a
      // refetch — the user's next action depends on seeing the real state.
      if (
        error instanceof UploadError &&
        (error.code === "QuotaExceeded" || error.code === "AlreadyExists")
      ) {
        void queryClient.invalidateQueries({ queryKey: ["personalLibrary"] });
      }
    },
    retry: false,
  });
};

/** Invalidate everything the library screen renders after a mutation. */
function useInvalidateLibrary() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["personalLibrary"] });
    void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
  };
}

export const useDeletePersonalBook = () => {
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ contentHash }: { contentHash: string }) => {
      return await enhancedAuthFetch<Record<string, never>>(
        `/xrpc/buzz.bookhive.deletePersonalBook`,
        { method: "POST", body: { contentHash } },
      );
    },
    onMutate: async ({ contentHash }) => {
      await queryClient.cancelQueries({ queryKey: ["personalLibrary"] });
      const previous = queryClient.getQueriesData({ queryKey: ["personalLibrary"] });
      queryClient.setQueriesData({ queryKey: ["personalLibrary"] }, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            books: page.books.filter((b: PersonalBook) => b.contentHash !== contentHash),
            total: Math.max(0, (page.total ?? 0) - 1),
          })),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: invalidateLibrary,
    retry: false,
  });
};

export const useLinkPersonalBook = () => {
  const invalidateLibrary = useInvalidateLibrary();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contentHash, hiveId }: { contentHash: string; hiveId: string }) => {
      return await enhancedAuthFetch<{ book: PersonalBook }>(
        `/xrpc/buzz.bookhive.linkPersonalBook`,
        { method: "POST", body: { contentHash, hiveId } },
      );
    },
    onSuccess: () => {
      invalidateLibrary();
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    retry: false,
  });
};

export const useUnlinkPersonalBook = () => {
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ contentHash }: { contentHash: string }) => {
      return await enhancedAuthFetch<{ book: PersonalBook }>(
        `/xrpc/buzz.bookhive.unlinkPersonalBook`,
        { method: "POST", body: { contentHash } },
      );
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useCreatePersonalShelf = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      return await enhancedAuthFetch<{ shelf: PersonalShelf }>(
        `/xrpc/buzz.bookhive.createPersonalShelf`,
        { method: "POST", body: input },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    },
    retry: false,
  });
};

export const useUpdatePersonalShelf = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; name?: string; description?: string }) => {
      return await enhancedAuthFetch<{ shelf: PersonalShelf }>(
        `/xrpc/buzz.bookhive.updatePersonalShelf`,
        { method: "POST", body: input },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    },
    retry: false,
  });
};

export const useDeletePersonalShelf = () => {
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      return await enhancedAuthFetch<Record<string, never>>(
        `/xrpc/buzz.bookhive.deletePersonalShelf`,
        { method: "POST", body: { id } },
      );
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useAddToPersonalShelf = () => {
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { shelfId: number; contentHash: string }) => {
      return await enhancedAuthFetch<Record<string, never>>(
        `/xrpc/buzz.bookhive.addToPersonalShelf`,
        { method: "POST", body: input },
      );
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useRemoveFromPersonalShelf = () => {
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { shelfId: number; contentHash: string }) => {
      return await enhancedAuthFetch<Record<string, never>>(
        `/xrpc/buzz.bookhive.removeFromPersonalShelf`,
        { method: "POST", body: input },
      );
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useLinkSyncDocument = () => {
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { document: string; hiveId: string }) => {
      return await enhancedAuthFetch<{ hiveId: string; bookTitle: string }>(`/library/sync/link`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      invalidateLibrary();
      // Linking can create the user_book record, which changes their shelves.
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    retry: false,
  });
};

export const useDismissSyncDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { document: string; dismissed: boolean }) => {
      return await enhancedAuthFetch<{ dismissed: boolean }>(`/library/sync/dismiss`, {
        method: "POST",
        body: input,
      });
    },
    onMutate: async ({ document, dismissed }) => {
      await queryClient.cancelQueries({ queryKey: ["syncDocuments"] });
      const previous = queryClient.getQueryData(["syncDocuments"]);
      queryClient.setQueryData(["syncDocuments"], (old: SyncDoc[] | undefined) =>
        old?.map((doc) => (doc.document === document ? { ...doc, dismissed } : doc)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["syncDocuments"], context?.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
    },
    retry: false,
  });
};

export const useRenameSyncDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { document: string; title: string }) => {
      return await enhancedAuthFetch<{ title: string }>(`/library/sync/rename`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
    },
    retry: false,
  });
};

export const useDeleteSyncDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ document }: { document: string }) => {
      return await enhancedAuthFetch<{ deleted: boolean }>(`/library/sync/delete`, {
        method: "POST",
        body: { document },
      });
    },
    onMutate: async ({ document }) => {
      await queryClient.cancelQueries({ queryKey: ["syncDocuments"] });
      const previous = queryClient.getQueryData(["syncDocuments"]);
      queryClient.setQueryData(["syncDocuments"], (old: SyncDoc[] | undefined) =>
        old?.filter((doc) => doc.document !== document),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["syncDocuments"], context?.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
    },
    retry: false,
  });
};
