import { useEffect, useState } from "hono/jsx/dom";
import type { HiveBook } from "../../../types";

type SearchState =
  | { status: "idle"; data: HiveBook[]; userStatuses: Record<string, string> }
  | { status: "loading"; data: HiveBook[]; userStatuses: Record<string, string> }
  | { status: "success"; data: HiveBook[]; userStatuses: Record<string, string> }
  | { status: "error"; data: HiveBook[]; userStatuses: Record<string, string> };

export function useSearchBooks(
  query: string,
  enabled: boolean,
  limit = 10,
): {
  data: HiveBook[];
  userStatuses: Record<string, string>;
  isFetching: boolean;
  isError: boolean;
  status: string;
} {
  const [state, setState] = useState<SearchState>({
    status: "idle",
    data: [],
    userStatuses: {},
  });

  useEffect(() => {
    if (!enabled || query.length <= 2) {
      setState({ status: "idle", data: [], userStatuses: {} });
      return;
    }

    const ac = new AbortController();
    setState((prev) => ({
      status: "loading",
      data: prev.data,
      userStatuses: prev.userStatuses,
    }));

    fetch(`/xrpc/buzz.bookhive.searchBooks?q=${encodeURIComponent(query)}&limit=${limit}`, {
      signal: ac.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Search failed");
        return res.json();
      })
      .then((data: { books?: HiveBook[]; userStatuses?: Record<string, string> } | HiveBook[]) => {
        if (ac.signal.aborted) return;
        const list = Array.isArray(data) ? data : (data?.books ?? []);
        const statuses = Array.isArray(data) ? {} : (data?.userStatuses ?? {});
        setState({ status: "success", data: list, userStatuses: statuses });
      })
      .catch((err) => {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setState((prev) => ({ status: "error", data: prev.data, userStatuses: prev.userStatuses }));
      });

    return () => ac.abort();
  }, [query, enabled]);

  return {
    data: state.data,
    userStatuses: state.userStatuses,
    isFetching: state.status === "loading",
    isError: state.status === "error",
    status: state.status,
  };
}
