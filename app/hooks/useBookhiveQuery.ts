import { authFetch, authSession, createSessionFetch, getBaseUrl } from "@/context/auth";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HiveBook, HiveId, GetBook, GetProfile } from "../../src/types";
import { useEffect } from "react";
import { useDebounce } from "./useDebounce";
import type { $output as UserListsOutput } from "../../src/bsky/lexicon/generated/types/buzz/bookhive/getUserLists";
import type {
  $output as ListDetailsOutput,
  ListView,
} from "../../src/bsky/lexicon/generated/types/buzz/bookhive/getList";
import { classifyNetworkError } from "@/utils/networkErrorHandler";
import { restoreListSnapshots } from "@/utils/catalogueLists";
import {
  bookMutationQueue,
  requireMutationSuccess,
  type BookUpdateInput,
} from "@/utils/bookMutations";
import { personalLibraryQuery, type PersonalLibraryFilters } from "@/utils/personalLibraryQuery";
import { nextOffset, nextFeedCursor, uniqueBooks } from "@/utils/discoveryPagination";
export type { BookUpdateInput } from "@/utils/bookMutations";

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
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
  // Keep the array-shaped API used by the book picker, while exposing pagination to Search.
  return {
    ...result,
    data:
      normalizedQuery && !isDebouncing && result.data ? uniqueBooks(result.data.pages) : undefined,
    isLoading: Boolean(normalizedQuery) && (isDebouncing || result.isLoading),
    isDebouncing,
  };
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
      const data = await enhancedAuthFetch<GetProfile.$output>(
        `/xrpc/buzz.bookhive.getProfile?did=${id || ""}`,
      );
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
  });
};

/**
 * Follow a DID
 */
export const useFollow = () => {
  return useFollowMutation(true);
};

export const useUnfollow = () => {
  return useFollowMutation(false);
};

function useFollowMutation(following: boolean) {
  const queryClient = useQueryClient();
  const sessionFetch = createSessionFetch();
  const session = authSession.capture();
  return useMutation({
    mutationFn: async ({ did }: { did: string }) => {
      return requireMutationSuccess(
        await sessionFetch<{ success: boolean }>(following ? "/api/follow" : "/api/unfollow", {
          method: "POST",
          body: { did },
          retry: false,
        }),
      );
    },
    onMutate: async ({ did }) => {
      session.assertCurrent();
      await queryClient.cancelQueries({ queryKey: ["profile", did] });
      session.assertCurrent();
      const previousProfile = queryClient.getQueryData(["profile", did]);
      queryClient.setQueryData(["profile", did], (old: any) => {
        if (!old) return old;
        return { ...old, profile: { ...old.profile, isFollowing: following } };
      });
      return { previousProfile };
    },
    onError: (_err, { did }, context) => {
      if (session.signal.aborted) return;
      if (context?.previousProfile) {
        queryClient.setQueryData(["profile", did], context.previousProfile);
      }
    },
    onSettled: (_data, _error, { did }) => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["profile", did] });
    },
    retry: false,
  });
}

/**
 * Update the status of a book
 */
export const useUpdateBook = () => {
  const queryClient = useQueryClient();
  const sessionFetch = createSessionFetch();
  const session = authSession.capture();
  const queue = bookMutationQueue(queryClient, () => !session.signal.aborted);
  return useMutation({
    mutationFn: (input: BookUpdateInput) => queue.update(input, sessionFetch),
    // A successful reread may have landed even if its response was lost.
    retry: false,
  });
};

export const useUpdateComment = () => {
  const queryClient = useQueryClient();
  const sessionFetch = createSessionFetch();
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
      return await sessionFetch<{ success: boolean; message: string }>(`/api/update-comment`, {
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
    // A lost response may already have created the comment; don't duplicate it.
    retry: false,
  });
};

/**
 * Delete a book from the user's library by HiveId
 */
export const useDeleteBook = () => {
  const queryClient = useQueryClient();
  const sessionFetch = createSessionFetch();
  const session = authSession.capture();
  const queue = bookMutationQueue(queryClient, () => !session.signal.aborted);
  return useMutation({
    mutationFn: ({ hiveId }: { hiveId: HiveId }) => queue.remove(hiveId, sessionFetch),
    retry: false,
  });
};

export const useExplore = (language?: string | null, showDirectory = false) => {
  // listGenres currently has no language parameter. Keep its all-language directory
  // separate from getExplore's language-filtered featured selection.
  const genreDirectory = useInfiniteQuery({
    queryKey: ["explore", "genreDirectory"] as const,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      enhancedAuthFetch<{ genres: { genre: string; count: number }[]; offset: number }>(
        `/xrpc/buzz.bookhive.listGenres?limit=50&offset=${pageParam}`,
        { signal },
      ),
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
        topAuthors: {
          author: string;
          bookCount: number;
          thumbnail?: string;
          avgRating?: number;
        }[];
      }>(url, { signal });
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return { ...explore, genreDirectory };
};

export type FeedActivity = {
  userDid: string;
  userHandle?: string;
  userAvatar?: string;
  hiveId: string;
  title: string;
  authors: string;
  status?: string;
  stars?: number;
  review?: string;
  createdAt: string;
  /** The activity time and sort key — prefer over createdAt for display. */
  indexedAt?: string;
  thumbnail: string;
  cover?: string;
};

export type FeedGroup = {
  kind: "single" | "burst";
  verb: string;
  total: number;
  truncated?: boolean;
  activities: FeedActivity[];
};

export const useFeed = (tab: "friends" | "all" | "tracking" = "friends") => {
  const client = useQueryClient();
  const queryKey = ["feed", "infinite", tab] as const;
  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      return await enhancedAuthFetch<{
        activities: FeedActivity[];
        groups?: FeedGroup[];
        cursor?: string;
        hasMore: boolean;
      }>(
        `/xrpc/buzz.bookhive.getFeed?tab=${tab}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        { signal },
      );
    },
    getNextPageParam: (page, _pages, _cursor, cursors) => nextFeedCursor(page, cursors),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  return {
    ...result,
    // Reset the actual active infinite query, not the page captured by a render.
    refresh: async () => {
      await client.cancelQueries({ queryKey, exact: true });
      await client.resetQueries({ queryKey, exact: true });
    },
  };
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

// ── Book Lists ──

// These are public catalogue AT-URI lists, not private numeric personal shelves.

export const useUserLists = (did?: string) => {
  return useQuery({
    queryKey: ["userLists", did] as const,
    queryFn: async ({ queryKey: [, d] }) => {
      return await enhancedAuthFetch<UserListsOutput>(
        `/xrpc/buzz.bookhive.getUserLists?did=${encodeURIComponent(String(d))}`,
      );
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
      return await enhancedAuthFetch<ListDetailsOutput>(
        `/xrpc/buzz.bookhive.getList?uri=${encodeURIComponent(String(u))}`,
      );
    },
    enabled: Boolean(uri),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useCreateList = () => {
  const queryClient = useQueryClient();
  const request = createSessionFetch();
  const session = authSession.capture();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      ordered?: boolean;
      tags?: string[];
    }) => {
      return await request<{ uri: string; cid: string }>(`/xrpc/buzz.bookhive.createList`, {
        method: "POST",
        body: input,
        retry: 0,
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
    },
    // A lost response may have created a list already. Never replay a create.
    retry: false,
  });
};

export const useUpdateList = () => {
  const queryClient = useQueryClient();
  const request = createSessionFetch();
  const session = authSession.capture();
  return useMutation({
    mutationFn: async (input: {
      uri: string;
      name?: string;
      description?: string;
      ordered?: boolean;
      tags?: string[];
    }) => {
      return await request<{ uri: string; cid: string }>(`/xrpc/buzz.bookhive.updateList`, {
        method: "POST",
        body: input,
      });
    },
    onMutate: async ({ uri, ...updates }) => {
      session.assertCurrent();
      await queryClient.cancelQueries({ queryKey: ["listDetails", uri] });
      session.assertCurrent();
      await queryClient.cancelQueries({ queryKey: ["userLists"] });
      session.assertCurrent();
      const previousDetails = queryClient.getQueryData<ListDetailsOutput>(["listDetails", uri]);
      const previousLists = queryClient.getQueriesData<UserListsOutput>({
        queryKey: ["userLists"],
      });
      const patch: Partial<Pick<ListView, "name" | "description" | "ordered" | "tags">> = {
        ...("name" in updates && { name: updates.name }),
        ...("description" in updates && { description: updates.description }),
        ...("ordered" in updates && { ordered: updates.ordered }),
        ...("tags" in updates && { tags: updates.tags }),
      };
      queryClient.setQueryData<ListDetailsOutput>(["listDetails", uri], (old) => {
        if (!old) return old;
        return {
          ...old,
          list: {
            ...old.list,
            ...patch,
          },
        };
      });
      queryClient.setQueriesData<UserListsOutput>({ queryKey: ["userLists"] }, (old) => {
        if (!old?.lists) return old;
        return {
          ...old,
          lists: old.lists.map((l) =>
            l.uri === uri
              ? {
                  ...l,
                  ...patch,
                }
              : l,
          ),
        };
      });
      return { previousDetails, previousLists };
    },
    onError: (_err, { uri }, context) => {
      if (session.signal.aborted) return;
      if (context?.previousDetails) {
        queryClient.setQueryData(["listDetails", uri], context.previousDetails);
      }
      if (context?.previousLists) {
        restoreListSnapshots(queryClient, context.previousLists);
      }
    },
    onSettled: (_data, _error, { uri }) => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
      void queryClient.invalidateQueries({ queryKey: ["listDetails", uri] });
    },
    retry: false,
  });
};

export const useDeleteList = () => {
  const queryClient = useQueryClient();
  const request = createSessionFetch();
  const session = authSession.capture();
  return useMutation({
    mutationFn: async ({ uri }: { uri: string }) => {
      return await request<{ success: boolean }>(`/xrpc/buzz.bookhive.deleteList`, {
        method: "POST",
        body: { uri },
      });
    },
    onMutate: async ({ uri }) => {
      session.assertCurrent();
      await queryClient.cancelQueries({ queryKey: ["userLists"] });
      session.assertCurrent();
      const previousLists = queryClient.getQueriesData({ queryKey: ["userLists"] });
      queryClient.setQueriesData({ queryKey: ["userLists"] }, (old: any) => {
        if (!old?.lists) return old;
        return { ...old, lists: old.lists.filter((l: any) => l.uri !== uri) };
      });
      return { previousLists };
    },
    onError: (_err, _vars, context) => {
      if (session.signal.aborted) return;
      if (context?.previousLists) {
        restoreListSnapshots(queryClient, context.previousLists);
      }
    },
    onSettled: (_data, _error, { uri }) => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["userLists"] });
      void queryClient.invalidateQueries({ queryKey: ["listDetails", uri] });
    },
    retry: false,
  });
};

export const useAddToList = () => {
  const queryClient = useQueryClient();
  const request = createSessionFetch();
  const session = authSession.capture();
  return useMutation({
    mutationFn: async (input: { listUri: string; hiveId: string }) => {
      return await request<{ uri: string }>(`/xrpc/buzz.bookhive.addToList`, {
        method: "POST",
        body: input,
        retry: 0,
      });
    },
    onSettled: (_data, _error, { listUri }) => {
      if (session.signal.aborted) return;
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["userLists"] }),
        queryClient.invalidateQueries({ queryKey: ["listDetails", listUri], exact: true }),
      ]);
    },
    retry: false,
  });
};

export const useRemoveFromList = () => {
  const queryClient = useQueryClient();
  const request = createSessionFetch();
  const session = authSession.capture();
  return useMutation({
    mutationFn: async ({ itemUri, listUri: _listUri }: { itemUri: string; listUri?: string }) => {
      return await request<{ success: boolean }>(`/xrpc/buzz.bookhive.removeFromList`, {
        method: "POST",
        body: { itemUri },
      });
    },
    onMutate: async ({ itemUri, listUri }) => {
      session.assertCurrent();
      if (!listUri) return {};
      await queryClient.cancelQueries({ queryKey: ["listDetails", listUri] });
      session.assertCurrent();
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
      if (session.signal.aborted) return;
      if (context?.previousDetails && context?.listUri) {
        queryClient.setQueryData(["listDetails", context.listUri], context.previousDetails);
      }
    },
    onSettled: (_data, _error, { listUri }) => {
      if (session.signal.aborted) return;
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["userLists"] }),
        queryClient.invalidateQueries({
          queryKey: listUri ? ["listDetails", listUri] : ["listDetails"],
        }),
      ]);
    },
    retry: false,
  });
};

export const useReorderList = () => {
  const queryClient = useQueryClient();
  const request = createSessionFetch();
  const session = authSession.capture();
  return useMutation({
    mutationFn: async (input: { listUri: string; itemUris: string[] }) =>
      request<Record<string, never>>("/xrpc/buzz.bookhive.reorderList", {
        method: "POST",
        body: input,
        retry: 0,
      }),
    retry: false,
    onMutate: async ({ listUri, itemUris }) => {
      session.assertCurrent();
      const key = ["listDetails", listUri] as const;
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      session.assertCurrent();
      const snapshots = queryClient.getQueriesData({ queryKey: key, exact: true });
      queryClient.setQueryData(key, (old: any) => {
        if (!old) return old;
        const positions = new Map(itemUris.map((uri, index) => [uri, index]));
        return {
          ...old,
          items: old.items
            .map((item: any) => ({
              ...item,
              position: positions.get(item.uri) ?? item.position,
            }))
            .sort((a: any, b: any) => a.position - b.position),
        };
      });
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      if (session.signal.aborted) return;
      if (context) restoreListSnapshots(queryClient, context.snapshots);
    },
    onSettled: (_data, _error, { listUri }) => {
      if (session.signal.aborted) return;
      return queryClient.invalidateQueries({ queryKey: ["listDetails", listUri], exact: true });
    },
  });
};

export const useReadingStats = (handle: string, year: number) => {
  return useQuery({
    queryKey: ["readingStats", handle, year] as const,
    queryFn: async ({ queryKey: [, h, y] }) => {
      return await enhancedAuthFetch<
        import("../../src/bsky/lexicon/generated/types/buzz/bookhive/getReadingStats").$output
      >(`/xrpc/buzz.bookhive.getReadingStats?handle=${encodeURIComponent(String(h))}&year=${y}`);
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

/** Per-user storage usage against the quota, returned on every `getPersonalLibrary` page so the meter stays honest without a separate fetch. */
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

export const usePersonalLibrary = (filters?: number | PersonalLibraryFilters) => {
  const request = createSessionFetch();
  const options = typeof filters === "number" ? { shelfId: filters } : filters;
  return useInfiniteQuery({
    queryKey: personalLibraryQuery(options).queryKey,
    initialPageParam: "",
    queryFn: async ({ queryKey: [, shelfId, q, sort], pageParam }) => {
      const { url } = personalLibraryQuery({ shelfId: shelfId ?? undefined, q, sort }, pageParam);
      return await request<{
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

/** Storage usage out of a `usePersonalLibrary` result — reads the last page, since each page carries a fresh value and the last is the most recently observed. */
export function storageFromLibrary(
  data: { pages: { storage?: PersonalStorage }[] } | undefined,
): PersonalStorage | null {
  if (!data?.pages.length) return null;
  return data.pages[data.pages.length - 1]?.storage ?? data.pages[0]?.storage ?? null;
}

export const usePersonalShelves = () => {
  const request = createSessionFetch();
  return useQuery({
    queryKey: ["personalShelves"] as const,
    queryFn: async () => {
      const result = await request<{ shelves: PersonalShelf[] }>(`/library/shelves`);
      return result?.shelves ?? [];
    },
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useSyncDocuments = () => {
  const request = createSessionFetch();
  return useQuery({
    queryKey: ["syncDocuments"] as const,
    queryFn: async () => {
      const result = await request<{ documents: SyncDoc[] }>(`/library/sync/documents`);
      return result?.documents ?? [];
    },
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useSyncPassword = () => {
  const request = createSessionFetch();
  return useQuery({
    queryKey: ["syncPassword"] as const,
    queryFn: async () => {
      const result = await request<{ password: string }>(`/settings/sync/password`);
      return result.password;
    },
    // Derived server-side from a rotation counter, so it only changes when the
    // user rotates it — no reason to refetch while the screen is open.
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  });
};

export const useRotateSyncPassword = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await request<{ password: string }>(`/settings/sync/rotate`, {
        method: "POST",
      });
    },
    onSuccess: ({ password }) => {
      if (session.signal.aborted) return;
      queryClient.setQueryData(["syncPassword"], password);
    },
    retry: false,
  });
};

/** An upload the server refused. `message` is shown verbatim; `code` is for deciding what else to do, like refreshing the storage meter after a quota rejection. */
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
 * Multipart upload with real progress. Uses XMLHttpRequest instead of the
 * shared fetch wrapper because React Native streams the file straight off disk
 * rather than loading it into JS memory, and `upload.onprogress` is the only
 * way to drive a determinate progress bar.
 */
function uploadBookFile(
  {
    uri,
    name,
    mime,
    onProgress,
  }: {
    uri: string;
    name: string;
    mime?: string;
    onProgress?: (fraction: number) => void;
  },
  session: ReturnType<typeof authSession.capture>,
): Promise<{ book: PersonalBook }> {
  session.assertCurrent();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", {
      uri,
      name,
      type: mime || "application/octet-stream",
    } as unknown as Blob);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${getBaseUrl()}/library/upload`);
    xhr.withCredentials = false;
    xhr.setRequestHeader("accept", "application/json");
    xhr.setRequestHeader("cookie", `sid=${session.state?.sid ?? ""}`);
    const abort = () => {
      xhr.abort();
      reject(new Error("Authentication session changed; upload cancelled"));
    };
    session.signal.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => session.signal.removeEventListener("abort", abort);

    xhr.upload.onprogress = (event) => {
      if (session.signal.aborted) return;
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      try {
        session.assertCurrent();
      } catch (error) {
        reject(error);
        return;
      }
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

    try {
      session.assertCurrent();
      xhr.send(form);
    } catch (error) {
      session.signal.removeEventListener("abort", abort);
      reject(error);
    }
  });
}

export const useUploadPersonalBook = () => {
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof uploadBookFile>[0]) => uploadBookFile(input, session),
    onSuccess: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["personalLibrary"] });
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
      // An upload can adopt a synced document (same content hash), which moves
      // it out of the triage list and into the grid.
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error) => {
      if (session.signal.aborted) return;
      // These codes mean our copy of the library disagrees with the server's, so refetch.
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
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return () => {
    if (session.signal.aborted) return;
    void queryClient.invalidateQueries({ queryKey: ["personalLibrary"] });
    void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
  };
}

export const useDeletePersonalBook = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ contentHash }: { contentHash: string }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.deletePersonalBook`, {
        method: "POST",
        body: { contentHash },
      });
    },
    onMutate: async ({ contentHash }) => {
      session.assertCurrent();
      await queryClient.cancelQueries({ queryKey: ["personalLibrary"] });
      session.assertCurrent();
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
      if (session.signal.aborted) return;
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: invalidateLibrary,
    retry: false,
  });
};

export const useLinkPersonalBook = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const invalidateLibrary = useInvalidateLibrary();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contentHash, hiveId }: { contentHash: string; hiveId: string }) => {
      return await request<{ book: PersonalBook }>(`/xrpc/buzz.bookhive.linkPersonalBook`, {
        method: "POST",
        body: { contentHash, hiveId },
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      invalidateLibrary();
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    retry: false,
  });
};

export const useUnlinkPersonalBook = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ contentHash }: { contentHash: string }) => {
      return await request<{ book: PersonalBook }>(`/xrpc/buzz.bookhive.unlinkPersonalBook`, {
        method: "POST",
        body: { contentHash },
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useCreatePersonalShelf = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      return await request<{ shelf: PersonalShelf }>(`/xrpc/buzz.bookhive.createPersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    },
    retry: false,
  });
};

export const useUpdatePersonalShelf = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; name?: string; description?: string }) => {
      return await request<{ shelf: PersonalShelf }>(`/xrpc/buzz.bookhive.updatePersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    },
    retry: false,
  });
};

export const useDeletePersonalShelf = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.deletePersonalShelf`, {
        method: "POST",
        body: { id },
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useAddToPersonalShelf = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { shelfId: number; contentHash: string }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.addToPersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useRemoveFromPersonalShelf = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { shelfId: number; contentHash: string }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.removeFromPersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useLinkSyncDocument = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { document: string; hiveId: string }) => {
      return await request<{ hiveId: string; bookTitle: string }>(`/library/sync/link`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      invalidateLibrary();
      // Linking can create the user_book record, which changes their shelves.
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    retry: false,
  });
};

export const useDismissSyncDocument = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { document: string; dismissed: boolean }) => {
      return await request<{ dismissed: boolean }>(`/library/sync/dismiss`, {
        method: "POST",
        body: input,
      });
    },
    onMutate: async ({ document, dismissed }) => {
      session.assertCurrent();
      await queryClient.cancelQueries({ queryKey: ["syncDocuments"] });
      session.assertCurrent();
      const previous = queryClient.getQueryData(["syncDocuments"]);
      queryClient.setQueryData(["syncDocuments"], (old: SyncDoc[] | undefined) =>
        old?.map((doc) => (doc.document === document ? { ...doc, dismissed } : doc)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (session.signal.aborted) return;
      queryClient.setQueryData(["syncDocuments"], context?.previous);
    },
    onSettled: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
    },
    retry: false,
  });
};

export const useRenameSyncDocument = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { document: string; title: string }) => {
      return await request<{ title: string }>(`/library/sync/rename`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
    },
    retry: false,
  });
};

export const useDeleteSyncDocument = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ document }: { document: string }) => {
      return await request<{ deleted: boolean }>(`/library/sync/delete`, {
        method: "POST",
        body: { document },
      });
    },
    onMutate: async ({ document }) => {
      session.assertCurrent();
      await queryClient.cancelQueries({ queryKey: ["syncDocuments"] });
      session.assertCurrent();
      const previous = queryClient.getQueryData(["syncDocuments"]);
      queryClient.setQueryData(["syncDocuments"], (old: SyncDoc[] | undefined) =>
        old?.filter((doc) => doc.document !== document),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (session.signal.aborted) return;
      queryClient.setQueryData(["syncDocuments"], context?.previous);
    },
    onSettled: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["syncDocuments"] });
    },
    retry: false,
  });
};
