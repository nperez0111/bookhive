import { act, renderHook, waitFor } from "@testing-library/react-native";
import { notifyManager, QueryClient } from "@tanstack/react-query";
import { authSession } from "@/context/auth";
import { queryWrapper } from "../../test/queryHelpers";
import { useRotateSyncPassword, useSyncPassword } from "../queries/sync";

const mockRequest = jest.fn();
jest.mock("@/context/auth", () => ({
  authSession: jest.requireActual("../../context/authSession").createAuthSessionScope(),
  createSessionFetch: () => mockRequest,
}));

let client: QueryClient;
const Wrapper = queryWrapper(() => client);
beforeEach(() => {
  notifyManager.setNotifyFunction((callback) => act(callback));
  mockRequest.mockReset();
  authSession.replace({ did: "did:plc:a", handle: "a.test", sid: "sid-a" });
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
});
afterEach(() => {
  client.clear();
  notifyManager.setNotifyFunction((callback) => callback());
});

it("clears the old password and re-reads after a lost rotation response without rotating twice", async () => {
  client.setQueryData(["syncPassword"], "old-password");
  mockRequest.mockImplementation((url: string) => {
    if (url.endsWith("/rotate")) return Promise.reject(new Error("response lost"));
    return Promise.resolve({ password: "server-current-password" });
  });
  const { result } = renderHook(
    () => ({ password: useSyncPassword(), rotate: useRotateSyncPassword() }),
    { wrapper: Wrapper },
  );
  expect(result.current.password.data).toBe("old-password");
  await act(async () => {
    await expect(result.current.rotate.mutateAsync()).rejects.toThrow("response lost");
  });
  await waitFor(() => expect(result.current.password.data).toBe("server-current-password"));
  expect(mockRequest.mock.calls.filter(([url]) => url.endsWith("/rotate"))).toHaveLength(1);
  expect(mockRequest.mock.calls.filter(([url]) => url.endsWith("/password"))).toHaveLength(1);
});

it("does not expose an indefinitely cached old password if the re-read also fails", async () => {
  client.setQueryData(["syncPassword"], "old-password");
  mockRequest.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(
    () => ({ password: useSyncPassword(), rotate: useRotateSyncPassword() }),
    { wrapper: Wrapper },
  );
  await act(async () => {
    await result.current.rotate.mutateAsync().catch(() => {});
  });
  await waitFor(() => expect(result.current.password.isError).toBe(true));
  expect(result.current.password.data).toBeUndefined();
});

it("a delayed rotation error cannot reset the new viewer's password", async () => {
  let reject!: (error: Error) => void;
  mockRequest.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  const { result } = renderHook(() => useRotateSyncPassword(), { wrapper: Wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.mutateAsync().catch(() => {});
  });
  await waitFor(() => expect(mockRequest).toHaveBeenCalled());
  await act(async () => {
    authSession.replace({ did: "did:plc:b", handle: "b.test", sid: "sid-b" });
    client.setQueryData(["syncPassword"], "B-password");
    reject(new Error("response lost"));
    await pending;
  });
  expect(client.getQueryData(["syncPassword"])).toBe("B-password");
});
