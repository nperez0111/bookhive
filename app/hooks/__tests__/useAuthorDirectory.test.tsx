import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";
import { queryWrapper } from "../../test/queryHelpers";
import { authFetch } from "@/context/auth";
import { useAuthorDirectory } from "../useAuthorDirectory";

jest.mock("@/context/auth", () => ({ authFetch: jest.fn() }));
const fetchMock = authFetch as jest.Mock;
let client: QueryClient;
const Wrapper = queryWrapper(() => client);
const page = (start: number, count: number, hasMore: boolean) => ({
  authors: Array.from({ length: count }, (_, i) => ({
    author: `Author${start + i}`,
    bookCount: 2,
    totalRatings: 20,
  })),
  offset: start + count,
  total: 51,
  hasMore,
  directoryLimit: 500,
});
beforeEach(() => {
  fetchMock.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  client.clear();
  jest.useRealTimers();
});

describe("useAuthorDirectory", () => {
  it("loads the directory for an empty normalized query", async () => {
    fetchMock.mockResolvedValue(page(0, 1, false));
    const { result } = renderHook(() => useAuthorDirectory("   ", "en"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/xrpc/buzz.bookhive.listAuthors?limit=50&offset=0&language=en",
    );
  });
  it("appends pages and honours explicit exhaustion instead of assuming a full last page means more", async () => {
    fetchMock.mockResolvedValueOnce(page(0, 50, true)).mockResolvedValueOnce(page(50, 1, false));
    const { result } = renderHook(() => useAuthorDirectory("", "en"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.authors).toHaveLength(50));
    expect(result.current.total).toBe(51);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.authors).toHaveLength(51));
    expect(fetchMock.mock.calls[1][0]).toContain("limit=50&offset=50&language=en");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("debounces normalized search keys and requests, cancels old work, and skips collapsed-directory requests", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ q, enabled }: { q: string; enabled: boolean }) =>
        useAuthorDirectory(q, "English", enabled),
      { initialProps: { q: "", enabled: false }, wrapper: Wrapper },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ q: "  Le Guin  ", enabled: true });
    act(() => jest.advanceTimersByTime(299));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/xrpc/buzz.bookhive.listAuthors?limit=50&offset=0&language=English&q=le%20guin",
    );
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender({ q: "Borges", enabled: true });
    expect(signal.aborted).toBe(true);
    expect(result.current.authors).toEqual([]);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(fetchMock.mock.calls[1][0]).toContain("offset=0&language=English&q=borges");
    const secondSignal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    rerender({ q: "Borges", enabled: false });
    expect(secondSignal.aborted).toBe(true);
  });

  it("resets pages and offset when the selected language changes", async () => {
    fetchMock
      .mockResolvedValueOnce(page(0, 50, true))
      .mockResolvedValueOnce(page(50, 1, false))
      .mockResolvedValueOnce({ ...page(0, 1, false), total: 1 });
    const { result, rerender } = renderHook(
      ({ language }: { language: string }) => useAuthorDirectory("", language),
      { initialProps: { language: "en" }, wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.authors).toHaveLength(50));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.authors).toHaveLength(51));
    rerender({ language: "fr" });
    expect(result.current.authors).toEqual([]);
    await waitFor(() => expect(result.current.authors).toHaveLength(1));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(fetchMock.mock.calls[2][0]).toContain("offset=0&language=fr");
  });

  it("retains loaded authors on a later-page error and retries that offset", async () => {
    fetchMock
      .mockResolvedValueOnce(page(0, 50, true))
      .mockRejectedValueOnce(new Error("Directory unavailable"))
      .mockResolvedValueOnce(page(50, 1, false));
    const { result } = renderHook(() => useAuthorDirectory(""), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.authors).toHaveLength(50));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.error?.message).toBe("Directory unavailable");
    expect(result.current.authors).toHaveLength(50);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.authors).toHaveLength(51));
    expect(fetchMock.mock.calls[2][0]).toContain("offset=50");
  });

  it("rejects a non-advancing next offset even when hasMore is incorrectly true", async () => {
    fetchMock.mockResolvedValue({ ...page(0, 0, true), offset: 0 });
    const { result } = renderHook(() => useAuthorDirectory(""), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
});
