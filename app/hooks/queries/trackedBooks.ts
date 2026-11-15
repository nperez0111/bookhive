import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authSession, createSessionFetch } from "@/context/auth";
import { enhancedAuthFetch } from "@/api/queryFetch";
import { requireMutationSuccess } from "@/api/mutationResult";
import { bookMutationQueue, type BookUpdateInput } from "@/utils/bookMutations";
import type { HiveId, GetBook } from "../../../src/types";

export type { BookUpdateInput } from "@/utils/bookMutations";

export const useBookInfo = (id: HiveId | undefined | null) => {
  return useQuery({
    queryKey: ["getBook", id] as const,
    queryFn: async ({ queryKey: [, hiveId] }) => {
      return await enhancedAuthFetch<GetBook.$output>(`/xrpc/buzz.bookhive.getBook?id=${hiveId}`);
    },
    enabled: Boolean(id),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

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
  const session = authSession.capture();
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
      return requireMutationSuccess(
        await sessionFetch<{ success: boolean; message: string }>(`/api/update-comment`, {
          method: "POST",
          body: { uri, hiveId, comment, parentUri, parentCid },
          retry: 0,
        }),
      );
    },
    onSuccess: (_, { hiveId }) => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["getBook", hiveId] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    // A lost response may already have created the comment; don't duplicate it.
    retry: false,
  });
};

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
