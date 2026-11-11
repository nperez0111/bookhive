import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { authSession, createSessionFetch } from "@/context/auth";

type Boundary = { targets: Set<string>; invalidations: Map<string, () => void> };
const boundaries = new WeakMap<QueryClient, Boundary>();
function boundary(client: QueryClient) {
  let state = boundaries.get(client);
  if (!state) {
    state = { targets: new Set(), invalidations: new Map() };
    boundaries.set(client, state);
  }
  return state;
}

function flush(state: Boundary) {
  if (state.targets.size) return;
  const callbacks = [...state.invalidations.values()];
  state.invalidations.clear();
  for (const invalidate of callbacks) invalidate();
}

/** Start before awaiting cancellation; no settlement may refetch over another draft. */
export function beginLibraryMutation(client: QueryClient, target: string) {
  const state = boundary(client);
  if (state.targets.has(target))
    throw new Error("This item is already being updated. Please wait.");
  state.targets.add(target);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    state.targets.delete(target);
    flush(state);
  };
}

/** Shared invalidation because file and sync mutations can move the same document. */
export function useInvalidateLibrary(
  keys = ["personalLibrary", "personalShelves", "syncDocuments"],
) {
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return () => {
    if (session.signal.aborted) return;
    const state = boundary(queryClient);
    for (const key of keys) {
      state.invalidations.set(key, () => {
        if (!session.signal.aborted) void queryClient.invalidateQueries({ queryKey: [key] });
      });
    }
    flush(state);
  };
}

/** Simple file/shelf/document writes; optimistic and multi-step writes stay in their domains. */
export function useLibraryWrite<
  Input extends Record<string, unknown>,
  Output = Record<string, never>,
>(url: string, keys?: string[]) {
  const request = createSessionFetch();
  const invalidate = useInvalidateLibrary(keys);
  return useMutation({
    mutationFn: (input: Input) => request<Output>(url, { method: "POST", body: input }),
    onSuccess: invalidate,
    retry: false,
  });
}
