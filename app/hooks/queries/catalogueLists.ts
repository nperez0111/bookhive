import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authSession, createSessionFetch } from "@/context/auth";
import { enhancedAuthFetch } from "@/api/queryFetch";
import { restoreListSnapshots } from "@/utils/catalogueLists";
import type { $output as UserListsOutput } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/getUserLists";
import type {
  $output as ListDetailsOutput,
  ListView,
} from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/getList";

// A failed write must not undo a concurrent edit to a different shelf.
function restoreOwnerList(
  client: ReturnType<typeof useQueryClient>,
  snapshots: [readonly unknown[], UserListsOutput | undefined][],
  uri: string,
) {
  for (const [key, previous] of snapshots) {
    const index = previous?.lists.findIndex((list) => list.uri === uri) ?? -1;
    if (!previous || index < 0) continue;
    const list = previous.lists[index]!;
    client.setQueryData<UserListsOutput>(key, (current) => {
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
      const previousLists = queryClient.getQueriesData<UserListsOutput>({
        queryKey: ["userLists", session.state?.did],
        exact: true,
      });
      const patch: Partial<Pick<ListView, "name" | "description" | "ordered" | "tags">> = {
        ...("name" in updates && { name: updates.name }),
        ...("description" in updates && { description: updates.description }),
        ...("ordered" in updates && { ordered: updates.ordered }),
        ...("tags" in updates && { tags: updates.tags }),
      };
      queryClient.setQueryData<ListDetailsOutput>(["listDetails", uri], (old) => {
        if (!old) return old;
        return { ...old, list: { ...old.list, ...patch } };
      });
      queryClient.setQueriesData<UserListsOutput>(
        { queryKey: ["userLists", session.state?.did], exact: true },
        (old) => {
          if (!old?.lists) return old;
          return { ...old, lists: old.lists.map((l) => (l.uri === uri ? { ...l, ...patch } : l)) };
        },
      );
      return { previousDetails, previousLists };
    },
    onError: (_err, { uri }, context) => {
      if (session.signal.aborted) return;
      if (context?.previousDetails)
        queryClient.setQueryData(["listDetails", uri], context.previousDetails);
      if (context?.previousLists) restoreOwnerList(queryClient, context.previousLists, uri);
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
      const previousLists = queryClient.getQueriesData<UserListsOutput>({
        queryKey: ["userLists", session.state?.did],
        exact: true,
      });
      queryClient.setQueriesData<UserListsOutput>(
        { queryKey: ["userLists", session.state?.did], exact: true },
        (old) => {
          if (!old?.lists) return old;
          return { ...old, lists: old.lists.filter((l) => l.uri !== uri) };
        },
      );
      return { previousLists };
    },
    onError: (_err, { uri }, context) => {
      if (session.signal.aborted) return;
      if (context?.previousLists) restoreOwnerList(queryClient, context.previousLists, uri);
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
      const snapshots = queryClient.getQueriesData<ListDetailsOutput>({
        queryKey: key,
        exact: true,
      });
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
