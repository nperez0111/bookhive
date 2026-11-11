import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authSession, createSessionFetch } from "@/context/auth";
import type { SyncDoc } from "@/api/personalLibraryTypes";
import {
  beginLibraryMutation,
  useInvalidateLibrary,
  useLibraryWrite,
} from "./personalLibraryCache";
import { bookMutationQueue } from "@/utils/bookMutations";

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
    // Derived from a rotation counter. Changes only when the viewer rotates it.
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  });
};

export const useRotateSyncPassword = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      await request<{ password: string }>(`/settings/sync/rotate`, { method: "POST" }),
    onSuccess: ({ password }) => {
      if (session.signal.aborted) return;
      queryClient.setQueryData(["syncPassword"], password);
    },
    onError: () => {
      if (session.signal.aborted) return;
      // A lost response may follow a successful rotation. Re-read, never replay it.
      void queryClient.resetQueries({ queryKey: ["syncPassword"], exact: true });
    },
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
    onSuccess: (_data, { hiveId }) => {
      if (session.signal.aborted) return;
      invalidateLibrary();
      // Linking can create a tracked reading record.
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      bookMutationQueue(queryClient, () => !session.signal.aborted).refresh(hiveId);
    },
    retry: false,
  });
};

export const useDismissSyncDocument = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLibrary(["syncDocuments"]);
  return useMutation({
    mutationFn: async (input: { document: string; dismissed: boolean }) => {
      return await request<{ dismissed: boolean }>(`/library/sync/dismiss`, {
        method: "POST",
        body: input,
      });
    },
    onMutate: async ({ document, dismissed }) => {
      session.assertCurrent();
      const finish = beginLibraryMutation(queryClient, `document:${document}`);
      try {
        await queryClient.cancelQueries({ queryKey: ["syncDocuments"] });
        session.assertCurrent();
        const previous = queryClient
          .getQueryData<SyncDoc[]>(["syncDocuments"])
          ?.find((doc) => doc.document === document);
        queryClient.setQueryData(["syncDocuments"], (old: SyncDoc[] | undefined) =>
          old?.map((doc) => (doc.document === document ? { ...doc, dismissed } : doc)),
        );
        return { previous, finish };
      } catch (error) {
        finish();
        throw error;
      }
    },
    onError: (_err, { document }, context) => {
      if (session.signal.aborted) return;
      if (!context?.previous) return;
      queryClient.setQueryData<SyncDoc[]>(["syncDocuments"], (current) =>
        current?.map((doc) =>
          doc.document === document ? { ...doc, dismissed: context.previous!.dismissed } : doc,
        ),
      );
    },
    onSettled: (_data, _error, _variables, context) => {
      invalidate();
      context?.finish();
    },
    retry: false,
  });
};

export const useRenameSyncDocument = () => {
  return useLibraryWrite<{ document: string; title: string }, { title: string }>(
    "/library/sync/rename",
    ["syncDocuments"],
  );
};

export const useDeleteSyncDocument = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLibrary(["syncDocuments"]);
  return useMutation({
    mutationFn: async ({ document }: { document: string }) => {
      return await request<{ deleted: boolean }>(`/library/sync/delete`, {
        method: "POST",
        body: { document },
      });
    },
    onMutate: async ({ document }) => {
      session.assertCurrent();
      const finish = beginLibraryMutation(queryClient, `document:${document}`);
      try {
        await queryClient.cancelQueries({ queryKey: ["syncDocuments"] });
        session.assertCurrent();
        const previous = queryClient.getQueryData<SyncDoc[]>(["syncDocuments"]);
        const index = previous?.findIndex((doc) => doc.document === document) ?? -1;
        queryClient.setQueryData(["syncDocuments"], (old: SyncDoc[] | undefined) =>
          old?.filter((doc) => doc.document !== document),
        );
        return {
          previous: index >= 0 ? previous?.[index] : undefined,
          after: previous?.slice(index + 1).map((doc) => doc.document) ?? [],
          finish,
        };
      } catch (error) {
        finish();
        throw error;
      }
    },
    onError: (_err, { document }, context) => {
      if (session.signal.aborted) return;
      if (!context?.previous) return;
      const previous = context.previous;
      queryClient.setQueryData<SyncDoc[]>(["syncDocuments"], (current) => {
        if (!current || current.some((doc) => doc.document === document)) return current;
        const restored = [...current];
        const next = context.after.find((id) => restored.some((doc) => doc.document === id));
        const index = next ? restored.findIndex((doc) => doc.document === next) : restored.length;
        restored.splice(index, 0, previous);
        return restored;
      });
    },
    onSettled: (_data, _error, _variables, context) => {
      invalidate();
      context?.finish();
    },
    retry: false,
  });
};
