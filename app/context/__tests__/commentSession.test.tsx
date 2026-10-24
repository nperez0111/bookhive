import { act, renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUpdateComment } from "../../hooks/useBookhiveQuery";
import type { HiveId } from "../../../src/types";

let mockEpoch = 1;
const mockNetwork = jest.fn();
jest.mock("@/utils/bookMutations", () => ({
  bookMutationQueue: jest.fn(),
  requireMutationSuccess: jest.fn(),
}));
jest.mock("@/context/auth", () => ({
  createSessionFetch: () => {
    const epoch = mockEpoch;
    return async (...args: unknown[]) => {
      if (epoch !== mockEpoch) throw new Error("Authentication session changed");
      return mockNetwork(...args);
    };
  },
  authSession: { capture: () => ({ signal: new AbortController().signal }) },
}));

const input = { hiveId: "bk_test" as HiveId, comment: "Hello", parentUri: "", parentCid: "" };

it("a retained A comment mutation cannot execute after account B mounts", async () => {
  const clientA = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const accountA = renderHook(useUpdateComment, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={clientA}>{children}</QueryClientProvider>
    ),
  });
  const submitA = accountA.result.current.mutateAsync;
  accountA.unmount();
  mockEpoch++;
  const clientB = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const accountB = renderHook(useUpdateComment, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={clientB}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await expect(submitA(input)).rejects.toThrow("session changed");
  });
  expect(mockNetwork).not.toHaveBeenCalled();
  mockNetwork.mockResolvedValueOnce({ success: true });
  await act(async () => {
    await accountB.result.current.mutateAsync(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mockNetwork).toHaveBeenCalledTimes(1);
  accountB.unmount();
  clientA.clear();
  clientB.clear();
});

it("does not replay a comment when the first response is lost", async () => {
  mockNetwork.mockReset().mockRejectedValue(new Error("Connection lost"));
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 2, retryDelay: 0, gcTime: Infinity } },
  });
  const { result, unmount } = renderHook(useUpdateComment, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await expect(result.current.mutateAsync(input)).rejects.toThrow("Connection lost");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mockNetwork).toHaveBeenCalledTimes(1);
  unmount();
  client.clear();
});
