import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react-native";
import {
  CancelledError,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import RootLayout from "../../app/_layout";
import { authSession, useAuth } from "@/context/auth";
import { useBookInfo, useProfile, useSearchBooks } from "@/hooks/useBookhiveQuery";
import { classifyNetworkError } from "@/utils/networkErrorHandler";
import { bookMutationQueue } from "@/utils/bookMutations";

const mockAccount = { did: "did:plc:alice", handle: "alice.test", sid: "alice-session" };
let mockClient: QueryClient;
let mockSignOut: () => Promise<void>;
function MockCaptureSession() {
  const client = useQueryClient();
  const { signOut } = useAuth();
  useEffect(() => {
    mockClient = client;
    mockSignOut = signOut;
  }, [client, signOut]);
  return null;
}

jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => JSON.stringify(mockAccount),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("ofetch", () => ({
  ofetch: { create: () => async () => ({ success: true, payload: mockAccount }) },
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "test" }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-router", () => {
  const Stack = ({ children }: { children: React.ReactNode }) => children;
  Stack.Protected = function Protected({
    guard,
    children,
  }: {
    guard: boolean;
    children: React.ReactNode;
  }) {
    return guard ? children : null;
  };
  Stack.Screen = function Screen() {
    return <MockCaptureSession />;
  };
  return {
    Stack,
    DarkTheme: { colors: {} },
    DefaultTheme: { colors: {} },
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock("@/context/language", () => ({
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@tanstack/query-async-storage-persister", () => ({
  createAsyncStoragePersister: () => ({}),
}));
jest.mock("@tanstack/react-query-persist-client", () => {
  const { QueryClientProvider } =
    jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    PersistQueryClientProvider: ({
      client,
      children,
    }: {
      client: QueryClient;
      children: React.ReactNode;
    }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
});
jest.mock("expo-font", () => ({ useFonts: () => [true] }));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: async () => {},
  hideAsync: async () => {},
}));
jest.mock("expo-updates", () => ({}));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-reanimated", () => ({}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@/components/NetworkErrorBoundary", () => ({
  NetworkErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/NetworkStatusIndicator", () => ({ NetworkStatusIndicator: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));

beforeEach(() => {
  // Exercise the real production client's 24h GC policy without keeping Jest alive.
  jest.useFakeTimers();
  authSession.replace(mockAccount);
});
afterEach(async () => {
  // Query.fetch schedules GC in finally, even if root cleanup has already removed
  // the query. Drain those cancellation continuations before restoring real timers.
  await act(async () => {
    cleanup();
    await mockClient?.cancelQueries();
  });
  mockClient?.clear();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("replaces root clients/queues on A → B and A → logout → A, synchronously aborting and clearing old work", async () => {
  const previous = mockClient;
  render(<RootLayout />);
  await waitFor(() => expect(mockClient).not.toBe(previous));
  const alice = mockClient;
  const aliceScope = authSession.capture();
  const aliceQueue = bookMutationQueue(alice, () => !aliceScope.signal.aborted);
  alice.setQueryData(["private"], "alice");
  let requestSignal: AbortSignal | undefined;
  const pending = alice
    .fetchQuery({
      queryKey: ["pending"],
      queryFn: ({ signal }) => {
        requestSignal = signal;
        return new Promise<string>(() => {});
      },
    })
    .catch(() => {});
  act(() => {
    authSession.replace({ did: "did:plc:bob", handle: "bob.test", sid: "bob-session" });
    // These checks run before React can mount the next client.
    expect(aliceScope.signal.aborted).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(alice.getQueryCache().getAll()).toHaveLength(0);
  });
  await pending;
  const bob = mockClient;
  expect(bob).not.toBe(alice);
  expect(bookMutationQueue(bob)).not.toBe(aliceQueue);
  expect(bob.getQueryData(["private"])).toBeUndefined();

  act(() => authSession.replace(mockAccount));
  const aliceAgain = mockClient;
  expect(aliceAgain).not.toBe(alice);
  expect(aliceAgain).not.toBe(bob);
  aliceAgain.setQueryData(["private"], "alice again");
  await act(async () => {
    const signedOut = mockSignOut();
    expect(authSession.state).toBeNull();
    expect(aliceAgain.getQueryCache().getAll()).toHaveLength(0);
    await signedOut;
  });
  const anonymous = mockClient;
  act(() => authSession.replace(mockAccount));
  expect(mockClient).not.toBe(anonymous);
  expect(mockClient).not.toBe(aliceAgain);
  expect(bookMutationQueue(mockClient)).not.toBe(bookMutationQueue(aliceAgain));
  expect(mockClient.getQueryData(["private"])).toBeUndefined();
});

it("real signOut cannot clear B when A's credential deletion finishes later", async () => {
  const previous = mockClient;
  render(<RootLayout />);
  await waitFor(() => expect(mockClient).not.toBe(previous));
  let finishStorage!: () => void;
  jest.mocked(SecureStore.deleteItemAsync).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishStorage = resolve;
    }),
  );
  const oldScope = authSession.capture();
  const oldClient = mockClient;
  oldClient.setQueryData(["private"], "alice");
  let signOut!: Promise<void>;
  act(() => {
    signOut = mockSignOut();
    expect(oldScope.signal.aborted).toBe(true);
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
  });
  const bob = { did: "did:plc:bob", handle: "bob.test", sid: "bob-session" };
  act(() => authSession.replace(bob));
  const bobClient = mockClient;
  bobClient.setQueryData(["private"], "bob");
  await waitFor(() => expect(finishStorage).toBeDefined());
  await act(async () => {
    finishStorage();
    await signOut;
  });
  expect(authSession.state).toEqual(bob);
  expect(mockClient).toBe(bobClient);
  expect(bobClient.getQueryData(["private"])).toBe("bob");
});

it("inherits root retry/backoff for search, book and profile, without enabling mutation retries", async () => {
  const previous = mockClient;
  render(<RootLayout />);
  await waitFor(() => expect(mockClient).not.toBe(previous));
  const client = mockClient;
  const hooks = renderHook(
    () => {
      useSearchBooks("");
      useBookInfo(undefined);
      useProfile();
    },
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  const defaults = client.getDefaultOptions();
  for (const key of [["searchBooks"], ["getBook"], ["profile"]]) {
    const query = client.getQueryCache().find({ queryKey: key, exact: false });
    expect(query?.options.retry).toBe(defaults.queries?.retry);
    expect(query?.options.retryDelay).toBe(defaults.queries?.retryDelay);
  }
  const retry = defaults.queries!.retry as (count: number, error: Error) => boolean;
  for (const status of [401, 403, 404, 408, 429, 500, 503]) {
    const error = Object.assign(new Error("request failed"), {
      networkError: classifyNetworkError({ status, message: "request failed" }),
    });
    expect(retry(0, error)).toBe(![401, 403, 404].includes(status));
    expect(retry(3, error)).toBe(false);
  }
  expect(retry(0, new TypeError("fetch failed"))).toBe(true);
  for (const status of [401, 403, 404, 503]) {
    for (const shape of [{ status }, { response: { status } }]) {
      const error = Object.assign(new Error("request failed"), shape);
      expect(retry(0, error)).toBe(status === 503);
      expect(retry(3, error)).toBe(false);
    }
  }
  expect(retry(0, Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(true);
  expect(retry(0, new CancelledError())).toBe(false);
  const aborted = Object.assign(new Error("cancelled"), { name: "AbortError" });
  expect(retry(0, aborted)).toBe(false);
  expect(retry(0, Object.assign(new Error("fetch aborted"), { cause: aborted }))).toBe(false);
  expect(retry(0, Object.assign(new Error("enhanced"), { originalError: aborted }))).toBe(false);
  expect(
    retry(
      0,
      Object.assign(new Error("request failed"), {
        cause: Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      }),
    ),
  ).toBe(true);
  expect(retry(0, new Error("Authentication session changed; request cancelled"))).toBe(false);
  const delay = defaults.queries!.retryDelay as (attempt: number) => number;
  expect([0, 1, 6].map(delay)).toEqual([1000, 2000, 30000]);
  expect(defaults.mutations?.retry).toBe(false);
  // Unmount consumers before their root provider clears the cache, avoiding orphaned GC timers.
  hooks.unmount();
});
