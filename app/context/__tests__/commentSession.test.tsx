import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";
import { useUpdateComment } from "../../hooks/useBookhiveQuery";
import type { HiveId } from "../../../src/types";
import { deferred, queryWrapper } from "../../test/queryHelpers";
import { createAuthSessionScope } from "../authSession";

const mockSession = createAuthSessionScope();
const mockNetwork = jest.fn();
jest.mock("@/utils/bookMutations", () => ({
  bookMutationQueue: jest.fn(),
}));
jest.mock("@/context/auth", () => ({
  createSessionFetch: () => {
    const session = mockSession.capture();
    return async (...args: unknown[]) => {
      session.assertCurrent();
      return mockNetwork(...args);
    };
  },
  get authSession() {
    return mockSession;
  },
}));

const input = { hiveId: "bk_test" as HiveId, comment: "Hello", parentUri: "", parentCid: "" };
beforeEach(() => {
  mockNetwork.mockReset();
  mockSession.replace({ did: "did:plc:a", handle: "a.test", sid: "sid-a" });
});

it("a retained A comment mutation cannot execute after account B mounts", async () => {
  const clientA = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const accountA = renderHook(useUpdateComment, {
    wrapper: queryWrapper(() => clientA),
  });
  const submitA = accountA.result.current.mutateAsync;
  accountA.unmount();
  mockSession.replace({ did: "did:plc:b", handle: "b.test", sid: "sid-b" });
  const clientB = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const accountB = renderHook(useUpdateComment, {
    wrapper: queryWrapper(() => clientB),
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
  mockNetwork.mockResolvedValueOnce({ success: false, message: "PDS write failed" });
  await act(async () => {
    await expect(accountB.result.current.mutateAsync(input)).rejects.toThrow("PDS write failed");
  });
  const response = deferred<unknown>();
  mockNetwork.mockReturnValueOnce(response.promise);
  let pending!: Promise<unknown>;
  act(() => {
    pending = accountB.result.current.mutateAsync(input);
  });
  await waitFor(() => expect(mockNetwork).toHaveBeenCalledTimes(3));
  const invalidate = jest.spyOn(clientB, "invalidateQueries");
  mockSession.replace(null);
  await act(async () => {
    response.resolve({ success: true });
    await pending;
  });
  expect(invalidate).not.toHaveBeenCalled();
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
    wrapper: queryWrapper(() => client),
  });
  await act(async () => {
    await expect(result.current.mutateAsync(input)).rejects.toThrow("Connection lost");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mockNetwork).toHaveBeenCalledTimes(1);
  unmount();
  client.clear();
});
