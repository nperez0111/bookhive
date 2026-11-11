import { useState } from "react";
import { Button, Text } from "react-native";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { router, Slot } from "expo-router";
import RootLayout from "../../app/_layout";
import TabLayout from "../../app/(tabs)/_layout";
import { authSession, getAuthState, useAuth } from "@/context/auth";
import { NetworkErrorView, type NetworkError } from "../NetworkErrorView";
import { BackNavigationHeader } from "../BackNavigationHeader";
import { classifyNetworkError } from "@/utils/networkErrorHandler";

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
jest.mock("@/components/AnimatedTabIcon", () => ({ AnimatedTabIcon: () => null }));
jest.mock("@/components/ui/TabBarBackground", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/HapticTab", () => ({
  HapticTab: (props: React.ComponentProps<typeof import("react-native").Pressable>) => {
    const { Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
    return <Pressable {...props} />;
  },
}));

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
      <Button
        title="Permission failure"
        onPress={() => setError(classifyNetworkError({ status: 403 }))}
      />
      <Button
        title="Temporary failure"
        onPress={() => setError(classifyNetworkError({ status: 503 }))}
      />
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

const detailScreens = Object.fromEntries(
  [
    "search",
    "feed",
    "book/[id]",
    "books/[status]",
    "profile/[did]",
    "profile/[did]/stats",
    "explore/genres/[genre]",
    "explore/authors/[author]",
    "settings",
    "account",
    "import",
    "lists/index",
    "lists/[uri]",
    "library/index",
    "sync/index",
  ].map((route) => [
    route,
    () => (
      <>
        <BackNavigationHeader />
        <Text>Detail: {route}</Text>
      </>
    ),
  ]),
);

function MyBooksScreen() {
  const [count, setCount] = useState(0);
  return (
    <>
      <Text>My Books collection</Text>
      <Button title={`Local state: ${count}`} onPress={() => setCount(count + 1)} />
    </>
  );
}

function renderNavigation(initialUrl = "/") {
  return renderRouter(
    {
      ...detailScreens,
      _layout: RootLayout,
      "(tabs)/_layout": TabLayout,
      "(tabs)/index": SessionErrorScreen,
      "(tabs)/my-books": MyBooksScreen,
      "(tabs)/explore": () => <Text>Discover books</Text>,
      "(tabs)/me": () => <Text>Reader profile</Text>,
      "(auth)/_layout": () => <Slot />,
      "(auth)/login": () => <Text>Login screen</Text>,
    },
    { initialUrl },
  );
}

it("pops detail screens back through their origin instead of switching hidden tabs", async () => {
  const navigation = renderNavigation();
  await waitFor(() => expect(screen.getByText("Signed in as alice.test")).toBeTruthy());
  for (const title of ["Home", "My Books", "Discover", "Profile"]) {
    expect(screen.getByText(title)).toBeOnTheScreen();
  }
  act(() => router.navigate("/my-books"));
  await waitFor(() => expect(screen.getByText("My Books collection")).toBeTruthy());
  fireEvent.press(screen.getByText("Local state: 0"));
  act(() => router.push("/search"));
  await waitFor(() => expect(navigation.getPathname()).toBe("/search"));
  act(() => router.push("/book/bk_test"));
  await waitFor(() => expect(navigation.getPathname()).toBe("/book/bk_test"));
  expect(router.canGoBack()).toBe(true);
  act(() => router.back());
  await waitFor(() => expect(navigation.getPathname()).toBe("/search"));
  act(() => router.back());
  await waitFor(() => expect(navigation.getPathname()).toBe("/my-books"));
  expect(screen.getByText("My Books collection")).toBeTruthy();
  expect(screen.getByText("Local state: 1")).toBeTruthy();
});

it("opens a signed-in book deep link without inventing a previous page", async () => {
  const navigation = renderNavigation("/book/bk_test");
  await waitFor(() => expect(screen.getByText("Detail: book/[id]")).toBeTruthy());
  expect(navigation.getPathname()).toBe("/book/bk_test");
  expect(router.canGoBack()).toBe(false);
  fireEvent.press(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/"));
  expect(screen.getByText("Signed in as alice.test")).toBeTruthy();
});

it("keeps transient failures signed in and explicitly signs out into the protected login route", async () => {
  // Use the real root Stack.Protected, AuthProvider/session scope and theme provider.
  // Only leaf screens and native services are replaced, not navigation or auth state.
  const navigation = renderNavigation();
  await waitFor(() => expect(screen.getByText("Signed in as alice.test")).toBeTruthy());
  expect(screen.getByText("Temporarily unavailable")).toBeTruthy();
  expect(getAuthState()).toEqual(mockAccount);
  expect(mockSecureDelete).not.toHaveBeenCalled();
  expect(screen.queryByText("Sign In")).toBeNull();
  fireEvent.press(screen.getByText("Permission failure"));
  expect(screen.getByText("Permission Denied")).toBeTruthy();
  expect(screen.queryByText("Sign In")).toBeNull();
  expect(getAuthState()).toEqual(mockAccount);
  // Restore the retryable error before testing the explicit expired-session action.
  fireEvent.press(screen.getByText("Temporary failure"));
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
  for (const route of Object.keys(detailScreens)) {
    const path = `/${route.replace(/\/index$/, "").replace(/\[[^\]]+\]/g, "test")}`;
    act(() => router.replace(path as Parameters<typeof router.replace>[0]));
    await waitFor(() => expect(navigation.getSegments()).toEqual(["(auth)", "login"]));
    expect(screen.getByText("Login screen")).toBeTruthy();
  }
});
