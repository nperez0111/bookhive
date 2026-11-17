import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { useAuth } from "@/context/auth";
import RootLayout from "../../app/_layout";
import { Colors } from "@/constants/Colors";

// Deliberately use the real useColorScheme and ThemeProvider: mocking either
// hides a startup crash when RootLayout consumes the theme above its provider.
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue("dark"),
  removeItem: jest.fn().mockResolvedValue(undefined),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Stack = ({ children }: { children: React.ReactNode }) => children;
  Stack.Protected = function Protected({ children }: { children: React.ReactNode }) {
    return children;
  };
  Stack.Screen = function Screen() {
    return null;
  };
  return {
    Stack,
    DarkTheme: { colors: {} },
    DefaultTheme: { colors: {} },
    ThemeProvider: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: { colors: { background: string } };
    }) =>
      React.createElement(
        View,
        { testID: "navigation-theme", style: { backgroundColor: value.colors.background } },
        children,
      ),
  };
});
jest.mock("@/context/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: jest.fn(() => ({ isAuthenticated: false, isRestoring: false, sessionEpoch: 0 })),
  authSession: { epoch: 0, subscribe: () => () => {} },
  getBaseUrl: () => "https://bookhive.buzz",
}));
jest.mock("@/context/language", () => ({
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@tanstack/query-async-storage-persister", () => ({
  createAsyncStoragePersister: () => ({}),
}));
jest.mock("@tanstack/react-query-persist-client", () => ({
  PersistQueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("expo-font", () => ({ useFonts: jest.fn(() => [true, null]) }));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: async () => {},
  hideAsync: jest.fn(async () => {}),
}));
jest.mock("expo-updates", () => ({}));
jest.mock("expo-status-bar", () => ({ StatusBar: jest.fn(() => null) }));
jest.mock("react-native-reanimated", () => ({}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 62 }) }));
jest.mock("@/components/NetworkErrorBoundary", () => ({
  NetworkErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/NetworkStatusIndicator", () => ({
  NetworkStatusIndicator: () => {
    const React = jest.requireActual<typeof import("react")>("react");
    const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
    const { useTheme } = jest.requireActual<typeof import("@/context/theme")>("@/context/theme");
    const { setThemeMode, isDark } = useTheme();
    return React.createElement(
      Pressable,
      { accessibilityRole: "button", onPress: () => setThemeMode(isDark ? "light" : "dark") },
      React.createElement(Text, null, "Toggle test theme"),
    );
  },
}));

beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({
    isAuthenticated: false,
    isRestoring: false,
    sessionEpoch: 0,
  } as ReturnType<typeof useAuth>);
  jest.mocked(useFonts).mockReturnValue([true, null]);
  jest.mocked(SplashScreen.hideAsync).mockClear();
});

it("shows the launch surface while reading theme preferences instead of leaving native splash blocking", async () => {
  let resolveTheme!: (theme: string) => void;
  jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveTheme = resolve;
    }),
  );
  await render(<RootLayout />);
  expect(screen.getByRole("progressbar")).toHaveTextContent("Opening your reading space…");
  await fireEvent(screen.getByTestId("launch-surface"), "layout", {
    nativeEvent: { layout: { width: 390, height: 844 } },
  });
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
  await act(async () => {
    resolveTheme("dark");
  });
  expect(screen.queryByTestId("launch-screen")).toBeNull();
  expect(screen.getByTestId("app-safe-area")).toHaveStyle({
    backgroundColor: Colors.dark.background,
  });
});

it("keeps native splash colors and transparent mark aligned with the JS launch surface", () => {
  const config = require("../../app.json");
  const [, splash] = config.expo.plugins.find(
    (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
  );
  expect(splash).toMatchObject({
    image: "./assets/images/bee.png",
    imageWidth: 160,
    backgroundColor: Colors.light.background,
    dark: { image: "./assets/images/bee.png", backgroundColor: Colors.dark.background },
  });
});

it("updates the iOS status background and system glyph tone with the theme, reserving the inset once", async () => {
  await render(<RootLayout />);
  await waitFor(() =>
    expect(screen.getByTestId("ios-status-area")).toHaveStyle({
      backgroundColor: Colors.dark.background,
      height: 62,
    }),
  );
  expect(screen.getByTestId("navigation-theme")).toHaveStyle({
    backgroundColor: Colors.dark.background,
  });
  expect(screen.getByTestId("app-safe-area")).toHaveStyle({
    paddingTop: 62,
    backgroundColor: Colors.dark.background,
  });
  expect(jest.mocked(StatusBar).mock.calls.at(-1)?.[0]).toMatchObject({ style: "light" });
  await fireEvent.press(screen.getByRole("button", { name: "Toggle test theme" }));
  expect(screen.getByTestId("ios-status-area")).toHaveStyle({
    backgroundColor: Colors.light.background,
  });
  expect(screen.getByTestId("app-safe-area")).toHaveStyle({
    paddingTop: 62,
    backgroundColor: Colors.light.background,
  });
  expect(jest.mocked(StatusBar).mock.calls.at(-1)?.[0]).toMatchObject({ style: "dark" });
});

it("reveals a themed session-loading surface on layout, without waiting for auth or fonts", async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ isAuthenticated: false, isRestoring: true, sessionEpoch: 0 } as ReturnType<
      typeof useAuth
    >);
  jest.mocked(useFonts).mockReturnValue([false, null]);
  jest.mocked(SplashScreen.hideAsync).mockClear();
  await render(<RootLayout />);
  expect(screen.getByTestId("launch-screen")).toHaveStyle({
    backgroundColor: Colors.dark.background,
  });
  expect(screen.getByRole("progressbar")).toHaveTextContent("Restoring your reading space…");
  expect(screen.queryByTestId("app-safe-area")).toBeNull();
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId("launch-surface"), "layout", {
    nativeEvent: { layout: { width: 390, height: 844 } },
  });
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
});

it("does not strand navigation behind a failed optional font", async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ isAuthenticated: false, isRestoring: false, sessionEpoch: 0 } as ReturnType<
      typeof useAuth
    >);
  jest.mocked(useFonts).mockReturnValue([false, new Error("Font unavailable")]);
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await render(<RootLayout />);
    expect(screen.getByTestId("app-safe-area")).toBeTruthy();
    expect(screen.queryByTestId("launch-screen")).toBeNull();
  } finally {
    warning.mockRestore();
  }
});
