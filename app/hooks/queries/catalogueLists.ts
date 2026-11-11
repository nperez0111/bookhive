import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authSession, createSessionFetch } from "@/context/auth";
import { enhancedAuthFetch } from "@/api/queryFetch";
import type { $output as UserListsOutput } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/getUserLists";
import type { $output as ListDetailsOutput } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/getList";

// A failed write must not undo a concurrent edit to a different shelf.
function restoreOwnerList(
  client: ReturnType<typeof useQueryClient>,
  ownerDid: string | undefined,
  previous: UserListsOutput | undefined,
  uri: string,
) {
  const index = previous?.lists.findIndex((list) => list.uri === uri) ?? -1;
  if (!previous || index < 0) return;
  const list = previous.lists[index]!;
  client.setQueryData<UserListsOutput>(["userLists", ownerDid], (current) => {
    if (!current) return current;
    if (current.lists.some((entry) => entry.uri === uri)) {
      return {
        ...current,
        lists: current.lists.map((entry) => (entry.uri === uri ? list : entry)),
      };
    }
    const lists = [...current.lists];
    lists.splice(index, 0, list);
    return { ...current, lists };
  });
}

// Public AT-URI catalogue lists, never private numeric ebook shelves.
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
    // A lost response may already have created the list. Never replay a create.
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
      const ownerKey = ["userLists", session.state?.did] as const;
      const previousLists = queryClient.getQueryData<UserListsOutput>(ownerKey);
      // Rest/spread preserves omitted fields as well as explicit empty/false values.
      queryClient.setQueryData<ListDetailsOutput>(["listDetails", uri], (old) => {
        if (!old) return old;
        return { ...old, list: { ...old.list, ...updates } };
      });
      queryClient.setQueryData<UserListsOutput>(ownerKey, (old) => {
        if (!old?.lists) return old;
        return { ...old, lists: old.lists.map((l) => (l.uri === uri ? { ...l, ...updates } : l)) };
      });
      return { previousDetails, previousLists };
    },
    onError: (_err, { uri }, context) => {
      if (session.signal.aborted) return;
      if (context?.previousDetails)
        queryClient.setQueryData(["listDetails", uri], context.previousDetails);
      restoreOwnerList(queryClient, session.state?.did, context?.previousLists, uri);
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
      const ownerKey = ["userLists", session.state?.did] as const;
      const previousLists = queryClient.getQueryData<UserListsOutput>(ownerKey);
      queryClient.setQueryData<UserListsOutput>(ownerKey, (old) => {
        if (!old?.lists) return old;
        return { ...old, lists: old.lists.filter((l) => l.uri !== uri) };
      });
      return { previousLists };
    },
    onError: (_err, { uri }, context) => {
      if (session.signal.aborted) return;
      restoreOwnerList(queryClient, session.state?.did, context?.previousLists, uri);
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
      const previousDetails = queryClient.getQueryData<ListDetailsOutput>(["listDetails", listUri]);
      queryClient.setQueryData<ListDetailsOutput>(["listDetails", listUri], (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((i) => i.uri !== itemUri),
          list: {
            ...old.list,
            itemCount: Math.max(
              0,
              (old.list.itemCount ?? 0) - Number(old.items.some((item) => item.uri === itemUri)),
            ),
          },
        };
      });
      return { previousDetails, listUri };
    },
    onError: (_err, _vars, context) => {
      if (session.signal.aborted) return;
      if (context?.previousDetails && context?.listUri)
        queryClient.setQueryData(["listDetails", context.listUri], context.previousDetails);
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
      const previous = queryClient.getQueryData<ListDetailsOutput>(key);
      queryClient.setQueryData<ListDetailsOutput>(key, (old) => {
        if (!old) return old;
        const positions = new Map(itemUris.map((uri, index) => [uri, index]));
        return {
          ...old,
          items: old.items
            .map((item) => ({ ...item, position: positions.get(item.uri) ?? item.position }))
            .sort((a, b) => Number(a.position) - Number(b.position)),
        };
      });
      return { previous };
    },
    onError: (_error, { listUri }, context) => {
      if (session.signal.aborted) return;
      if (context?.previous) queryClient.setQueryData(["listDetails", listUri], context.previous);
    },
    onSettled: (_data, _error, { listUri }) => {
      if (session.signal.aborted) return;
      return queryClient.invalidateQueries({ queryKey: ["listDetails", listUri], exact: true });
    },
  });
};
