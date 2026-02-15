import { useEffect, useState } from "hono/jsx/dom";
import type { HiveBook } from "../../../types";

type SearchState =
  | { status: "idle"; data: HiveBook[] }
  | { status: "loading"; data: HiveBook[] }
  | { status: "success"; data: HiveBook[] }
  | { status: "error"; data: HiveBook[] };

export function useSearchBooks(
  query: string,
  enabled: boolean,
): { data: HiveBook[]; isFetching: boolean; isError: boolean; status: string } {
  const [state, setState] = useState<SearchState>({
    status: "idle",
    data: [],
  });

  useEffect(() => {
    if (!enabled || query.length <= 2) {
      setState((prev) => ({
        status: "idle",
        data: prev.status === "success" ? prev.data : [],
      }));
      return;
    }

    const ac = new AbortController();
    setState((prev) => ({
      status: "loading",
      data: prev.data,
    }));

    fetch(
      `/xrpc/buzz.bookhive.searchBooks?q=${encodeURIComponent(query)}&limit=10`,
      { signal: ac.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error("Search failed");
        return res.json();
      })
      .then((data: { books?: HiveBook[] } | HiveBook[]) => {
        const list = Array.isArray(data) ? data : (data?.books ?? []);
        setState({ status: "success", data: list });
      })
      .catch(() => {
        setState((prev) => ({ status: "error", data: prev.data }));
      });

    return () => ac.abort();
  }, [query, enabled]);

  return {
    data: state.data,
    isFetching: state.status === "loading",
    isError: state.status === "error",
    status: state.status,
  };
}
