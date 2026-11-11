import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AuthProvider, authFetch, createSessionFetch, getAuthState, useAuth } from "../auth";
import { deferred } from "../../test/queryHelpers";

const mockA = { did: "did:plc:a", handle: "a.test", sid: "sid-a" };
const mockFetch = jest.fn();
const mockOpenBrowser = jest.fn();
const mockSecureSet = jest.fn().mockResolvedValue(undefined);
const mockSecureDelete = jest.fn().mockResolvedValue(undefined);

const callback = (account: string) => ({
  type: "success",
  url: `bookhive://oauth-callback?did=did:plc:${account}&handle=${account}.test&sid=sid-${account}`,
});
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

it("a newer OAuth attempt supersedes an older callback even if the newer attempt cancels", async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  const older = deferred<ReturnType<typeof callback>>();
  mockOpenBrowser.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ type: "cancel" });
  const first = result.current.signIn({ handle: "a.test" });
  await expect(result.current.signIn({ handle: "b.test" })).resolves.toBe("cancelled");
  older.resolve(callback("a"));
  await expect(first).resolves.toBe("cancelled");
  expect(getAuthState()).toBeNull();
});

it("removes obsolete credentials when a newer attempt starts during a SecureStore write", async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  const write = deferred<void>();
  mockSecureSet.mockReturnValueOnce(write.promise);
  mockOpenBrowser.mockResolvedValueOnce(callback("a")).mockResolvedValueOnce({ type: "cancel" });
  const first = result.current.signIn({ handle: "a.test" });
  await waitFor(() => expect(mockSecureSet.mock.results.at(-1)?.value).toBe(write.promise));
  await expect(result.current.signIn({ handle: "b.test" })).resolves.toBe("cancelled");
  const deletes = mockSecureDelete.mock.calls.length;
  write.resolve();
  await expect(first).resolves.toBe("cancelled");
  expect(mockSecureDelete).toHaveBeenCalledTimes(deletes + 1);
  expect(getAuthState()).toBeNull();
});

it("logout clears live credentials even when deleting stored credentials fails", async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  mockOpenBrowser.mockResolvedValueOnce(callback("a"));
  await act(async () => {
    await result.current.signIn({ handle: "a.test" });
  });
  const oldFetch = createSessionFetch();
  mockSecureDelete.mockRejectedValueOnce(new Error("storage unavailable"));
  await act(async () => {
    const logout = result.current.signOut();
    expect(getAuthState()).toBeNull();
    await expect(logout).rejects.toThrow("storage unavailable");
  });
  expect(result.current.isAuthenticated).toBe(false);
  await expect(oldFetch("/private")).rejects.toThrow("session changed");
  mockOpenBrowser.mockResolvedValueOnce(callback("b"));
  await act(async () => {
    await result.current.signIn({ handle: "b.test" });
  });
  expect(getAuthState()?.sid).toBe("sid-b");
  await act(async () => {
    await result.current.signOut();
  });
});

it("an OAuth callback arriving after logout cannot restore the old session", async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  const browser = deferred<ReturnType<typeof callback>>();
  mockOpenBrowser.mockReturnValueOnce(browser.promise);
  const login = result.current.signIn({ handle: "a.test" });
  await act(async () => {
    await result.current.signOut();
  });
  browser.resolve(callback("a"));
  await expect(login).resolves.toBe("cancelled");
  expect(getAuthState()).toBeNull();
});

it("an older OAuth callback cannot replace a newer successful login", async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  const browser = deferred<ReturnType<typeof callback>>();
  mockOpenBrowser.mockReturnValueOnce(browser.promise).mockResolvedValueOnce(callback("b"));
  const older = result.current.signIn({ handle: "a.test" });
  await act(async () => {
    await expect(result.current.signIn({ handle: "b.test" })).resolves.toBe("success");
  });
  browser.resolve(callback("a"));
  await expect(older).resolves.toBe("cancelled");
  expect(getAuthState()?.sid).toBe("sid-b");
  await act(async () => {
    await result.current.signOut();
  });
});

it.each([
  "bookhive://wrong-callback?did=did:plc:a&handle=a.test&sid=sid-a",
  "bookhive://oauth-callback?did=did:plc:a&handle=a.test",
])("rejects malformed OAuth callback %s without storing credentials", async (url) => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  const writes = mockSecureSet.mock.calls.length;
  mockOpenBrowser.mockResolvedValueOnce({ type: "success", url });
  await expect(result.current.signIn({ handle: "a.test" })).rejects.toThrow();
  expect(getAuthState()).toBeNull();
  expect(mockSecureSet).toHaveBeenCalledTimes(writes);
});
