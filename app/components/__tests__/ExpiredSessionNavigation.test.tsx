import { useState } from "react";
import { Text } from "react-native";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { router, Slot } from "expo-router";
import RootLayout from "../../app/_layout";
import { authSession, getAuthState, useAuth } from "@/context/auth";
import { NetworkErrorView, type NetworkError } from "../NetworkErrorView";

const mockAccount = { did: "did:plc:alice", handle: "alice.test", sid: "saved-session" };
const mockSecureDelete = jest.fn().mockResolvedValue(undefined);
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => JSON.stringify(mockAccount),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: (...args: unknown[]) => mockSecureDelete(...args),
}));
jest.mock("ofetch", () => ({
  ofetch: {
    create: () => async () => ({ success: true, payload: mockAccount }),
  },
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "test" }));
jest.mock("@tanstack/query-async-storage-persister", () => ({
  createAsyncStoragePersister: () => ({}),
}));
jest.mock("@tanstack/react-query-persist-client", () => ({
  PersistQueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("expo-font", () => ({ useFonts: () => [true] }));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: async () => {},
  hideAsync: async () => {},
}));
jest.mock("expo-updates", () => ({}));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-reanimated", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("@/components/NetworkStatusIndicator", () => ({ NetworkStatusIndicator: () => null }));

function SessionErrorScreen() {
  const { authState } = useAuth();
  const [error, setError] = useState<NetworkError>({
    type: "server",
    statusCode: 503,
    message: "Temporarily unavailable",
    retryable: true,
  });
  return (
    <>
      <Text>Signed in as {authState?.handle}</Text>
      <NetworkErrorView
        error={error}
        onRetry={() =>
          setError({
            type: "unauthorized",
            statusCode: 401,
            message: "Your session has expired. Please sign in again.",
            retryable: false,
          })
        }
      />
    </>
  );
}

it("keeps transient failures signed in and explicitly signs out into the protected login route", async () => {
  // Use the real root Stack.Protected, AuthProvider/session scope and theme provider.
  // Only leaf screens and native services are replaced, not navigation or auth state.
  const navigation = renderRouter(
    {
      _layout: RootLayout,
      "(tabs)/_layout": () => <Slot />,
      "(tabs)/index": SessionErrorScreen,
      "(auth)/_layout": () => <Slot />,
      "(auth)/login": () => <Text>Login screen</Text>,
    },
    { initialUrl: "/" },
  );
  await waitFor(() => expect(screen.getByText("Signed in as alice.test")).toBeTruthy());
  expect(screen.getByText("Temporarily unavailable")).toBeTruthy();
  expect(getAuthState()).toEqual(mockAccount);
  expect(mockSecureDelete).not.toHaveBeenCalled();
  expect(screen.queryByText("Sign In")).toBeNull();
  const oldSession = authSession.capture();

  fireEvent.press(screen.getByText("Try Again"));
  expect(screen.getByText("Your session has expired. Please sign in again.")).toBeTruthy();
  expect(getAuthState()).toEqual(mockAccount);
  expect(screen.queryByText("Login screen")).toBeNull();

  fireEvent.press(screen.getByText("Sign In"));
  await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
  await waitFor(() => expect(mockSecureDelete).toHaveBeenCalledWith("authState"));
  expect(getAuthState()).toBeNull();
  expect(oldSession.signal.aborted).toBe(true);
  expect(navigation.getSegments()).toEqual(["(auth)", "login"]);
  expect(navigation.getPathname()).toBe("/login");
  expect(screen.queryByText("Signed in as alice.test")).toBeNull();
  // A stale navigation into the now-protected tabs must not bounce login back out.
  act(() => router.replace("/(tabs)"));
  await waitFor(() => expect(navigation.getSegments()).toEqual(["(auth)", "login"]));
  expect(screen.getByText("Login screen")).toBeTruthy();
  expect(getAuthState()).toBeNull();
});
