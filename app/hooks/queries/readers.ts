import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { authSession, createSessionFetch } from "@/context/auth";
import { enhancedAuthFetch } from "@/api/queryFetch";
import { requireMutationSuccess } from "@/api/mutationResult";
import { nextFeedCursor } from "@/utils/discoveryPagination";
import type { GetProfile } from "../../../src/types";

export const useProfile = (did?: string) => {
  return useQuery({
    queryKey: ["profile", did] as const,
    queryFn: async ({ queryKey: [, id] }) => {
      return await enhancedAuthFetch<GetProfile.$output>(
        `/xrpc/buzz.bookhive.getProfile?did=${id || ""}`,
      );
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useFollow = () => useFollowMutation(true);
export const useUnfollow = () => useFollowMutation(false);

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
      const previousProfile = queryClient.getQueryData<GetProfile.$output>(["profile", did]);
      queryClient.setQueryData<GetProfile.$output>(["profile", did], (old) => {
        if (!old) return old;
        return { ...old, profile: { ...old.profile, isFollowing: following } };
      });
      return { previousProfile };
    },
    onError: (_err, { did }, context) => {
      if (session.signal.aborted) return;
      if (context?.previousProfile)
        queryClient.setQueryData(["profile", did], context.previousProfile);
    },
    onSettled: (_data, _error, { did }) => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["profile", did] });
    },
    retry: false,
  });
}

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
  /** Activity sort/display time, preferred over createdAt. */
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
  const session = authSession.capture();
  const queryKey = ["feed", "infinite", tab] as const;
  const options = infiniteQueryOptions({
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
  const result = useInfiniteQuery(options);
  return {
    ...result,
    refresh: async () => {
      if (session.signal.aborted) return;
      await client.cancelQueries({ queryKey, exact: true });
      if (session.signal.aborted) return;
      // Fetch one fresh first page without deleting the old pages. Query errors
      // remain exposed on `result.error`, with the last readable feed intact.
      await client.fetchInfiniteQuery({ ...options, pages: 1, staleTime: 0 }).catch(() => {});
    },
  };
};

export const useReadingStats = (handle: string, year: number) => {
  return useQuery({
    queryKey: ["readingStats", handle, year] as const,
    queryFn: async ({ queryKey: [, h, y] }) => {
      return await enhancedAuthFetch<
        import("../../../src/bsky/lexicon/generated/types/buzz/bookhive/getReadingStats").$output
      >(`/xrpc/buzz.bookhive.getReadingStats?handle=${encodeURIComponent(String(h))}&year=${y}`);
    },
    enabled: Boolean(handle),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};
