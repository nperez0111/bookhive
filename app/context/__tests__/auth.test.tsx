import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AuthProvider, authFetch, createSessionFetch, getAuthState, useAuth } from "../auth";

const mockA = { did: "did:plc:a", handle: "a.test", sid: "sid-a" };
const mockFetch = jest.fn();
const mockOpenBrowser = jest.fn();
const mockSecureSet = jest.fn().mockResolvedValue(undefined);
const mockSecureDelete = jest.fn().mockResolvedValue(undefined);
jest.mock("ofetch", () => ({
  ofetch: {
    create:
      () =>
      (...args: unknown[]) =>
        mockFetch(...args),
  },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => JSON.stringify(mockA),
  setItemAsync: (...args: unknown[]) => mockSecureSet(...args),
  deleteItemAsync: (...args: unknown[]) => mockSecureDelete(...args),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-linking", () => ({ createURL: () => "bookhive://oauth-callback" }));
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenBrowser(...args),
}));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "test" }));
jest.mock("expo-constants", () => ({ expoConfig: { version: "test" } }));

it("restores offline, keeps cancellation signed out, and never sends A's delayed requests as B", async () => {
  mockFetch.mockRejectedValueOnce(new Error("offline"));
  const { result, unmount } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  expect(result.current.isRestoring).toBe(true);
  await waitFor(() => expect(result.current.isRestoring).toBe(false));
  expect(result.current.authState).toEqual(mockA);
  expect(mockSecureDelete).not.toHaveBeenCalled();

  const oldFetch = createSessionFetch();
  let finishRequest!: (value: unknown) => void;
  mockFetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
  );
  const pending = authFetch("/private");
  const rejected = expect(pending).rejects.toThrow("session changed");
  expect(mockFetch.mock.calls.at(-1)?.[1].headers.get("cookie")).toBe("sid=sid-a");

  await act(async () => {
    await result.current.signOut();
  });
  expect(getAuthState()).toBeNull();
  expect(mockFetch.mock.calls.at(-1)?.[1].signal.aborted).toBe(true);
  mockOpenBrowser.mockResolvedValueOnce({ type: "cancel" });
  await act(async () => {
    expect(await result.current.signIn({ handle: "b.test" })).toBe("cancelled");
  });
  expect(result.current.isAuthenticated).toBe(false);

  mockOpenBrowser.mockResolvedValueOnce({
    type: "success",
    url: "bookhive://oauth-callback?did=did:plc:b&handle=b.test&sid=sid-b",
  });
  await act(async () => {
    expect(await result.current.signIn({ handle: "b.test" })).toBe("success");
  });
  expect(getAuthState()?.sid).toBe("sid-b");
  const callCount = mockFetch.mock.calls.length;
  await expect(oldFetch("/private")).rejects.toThrow("session changed");
  expect(mockFetch).toHaveBeenCalledTimes(callCount);
  finishRequest({ private: "account A" });
  await rejected;
  mockFetch.mockResolvedValueOnce({ ok: true });
  await authFetch("/private");
  expect(mockFetch.mock.calls.at(-1)?.[1].headers.get("cookie")).toBe("sid=sid-b");
  await act(async () => {
    await result.current.signOut();
  });
  unmount();
  const remounted = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(async () => {});
  expect(remounted.result.current.isRestoring).toBe(false);
  expect(remounted.result.current.isAuthenticated).toBe(false);
  expect(getAuthState()).toBeNull();
});
