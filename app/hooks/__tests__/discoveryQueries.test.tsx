import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";
import { queryWrapper } from "../../test/queryHelpers";
import { authFetch, authSession } from "@/context/auth";
import { useFeed, useGenreBooks, useSearchBooks } from "../useBookhiveQuery";

jest.mock("@/context/auth", () => {
  const { createAuthSessionScope } = jest.requireActual("../../context/authSession");
  return { authFetch: jest.fn(), authSession: createAuthSessionScope() };
});
// These domains share the hook module, but are not part of discovery's contract.
jest.mock("@/utils/bookMutations", () => ({}));
jest.mock("@/utils/catalogueLists", () => ({}));
jest.mock("@/utils/personalLibraryQuery", () => ({}));
jest.mock("@/utils/networkErrorHandler", () => ({
  classifyNetworkError: (error: Error) => ({ message: error.message, retryable: false }),
}));

const fetchMock = authFetch as jest.Mock;
function deferredValue() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let client: QueryClient;
const Wrapper = queryWrapper(() => client);

beforeEach(() => {
  fetchMock.mockReset();
  authSession.replace({ did: "did:plc:a", handle: "a.test", sid: "a-sid" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  client.clear();
  jest.useRealTimers();
});

describe("mobile discovery queries", () => {
  it("debounces both the cache key and request, and cancels stale search work", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearchBooks(q), {
      initialProps: { q: "" },
      wrapper: Wrapper,
    });
    rerender({ q: "d" });
    act(() => jest.advanceTimersByTime(100));
    rerender({ q: "dune" });
    act(() => jest.advanceTimersByTime(299));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("q=dune&limit=25&offset=0");
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender({ q: "dunes" });
    expect(signal.aborted).toBe(true);
    expect(result.current.data).toBeUndefined();
    rerender({ q: "   " });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });

  it("retains feed pages and exposes failures fetching later pages", async () => {
    fetchMock.mockResolvedValueOnce({ activities: [], hasMore: true, cursor: "next" });
    fetchMock.mockRejectedValueOnce(new Error("Later page unavailable"));
    const { result } = renderHook(() => useFeed("all"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.error?.message).toBe("Later page unavailable");
  });

  it("keeps both cached pages through a failed refresh, then replaces them with a fresh first page", async () => {
    fetchMock.mockResolvedValueOnce({
      activities: [{ title: "Old first" }],
      hasMore: true,
      cursor: "opaque/next",
    });
    fetchMock.mockResolvedValueOnce({ activities: [{ title: "Old second" }], hasMore: false });
    const { result } = renderHook(() => useFeed("all"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=opaque%2Fnext");
    const cached = result.current.data;
    const offline = deferredValue();
    fetchMock.mockReturnValueOnce(offline.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.data).toEqual(cached);
    await act(async () => {
      offline.reject(new Error("Offline"));
      await refresh;
    });
    await waitFor(() => expect(result.current.error?.message).toBe("Offline"));
    expect(result.current.data).toEqual(cached);
    expect(result.current.isRefetchError).toBe(true);
    const next = deferredValue();
    fetchMock.mockReturnValueOnce(next.promise);
    act(() => {
      refresh = result.current.refresh();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(result.current.data).toEqual(cached);
    await act(async () => {
      next.resolve({ activities: [{ title: "Fresh first" }], hasMore: true, cursor: "fresh-next" });
      await refresh;
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.data?.pageParams).toEqual([""]);
    expect(result.current.data?.pages[0]?.cursor).toBe("fresh-next");
    expect(fetchMock.mock.calls.slice(2).map(([url]) => url)).toEqual([
      "/xrpc/buzz.bookhive.getFeed?tab=all",
      "/xrpc/buzz.bookhive.getFeed?tab=all",
    ]);
  });

  it("a retained refresh cannot start after its session is replaced", async () => {
    fetchMock.mockResolvedValue({ activities: [], hasMore: false });
    const { result } = renderHook(() => useFeed("all"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const refresh = result.current.refresh;
    authSession.replace({ did: "did:plc:b", handle: "b.test", sid: "b-sid" });
    await act(async () => {
      await refresh();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("changes language without carrying the previous genre's offset or pages", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      books: Array.from({ length: 50 }, (_, id) => ({ id: `${url}:${id}` })),
      offset: url.includes("offset=50") ? 100 : 50,
    }));
    const { result, rerender } = renderHook(
      ({ language }: { language: string }) => useGenreBooks("Fantasy", language),
      {
        initialProps: { language: "en" },
        wrapper: Wrapper,
      },
    );
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      const response = await result.current.fetchNextPage();
      expect(response.data?.pages).toHaveLength(2);
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/xrpc/buzz.bookhive.searchBooks?genre=Fantasy&limit=50&offset=0&language=en",
      "/xrpc/buzz.bookhive.searchBooks?genre=Fantasy&limit=50&offset=50&language=en",
    ]);
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    rerender({ language: "fr" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(fetchMock.mock.calls[2][0]).toContain("offset=0&language=fr");
  });
});
