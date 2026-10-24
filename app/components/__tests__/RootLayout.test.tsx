import { render, screen, waitFor } from "@testing-library/react-native";
import RootLayout from "../../app/_layout";
import { Colors } from "@/constants/Colors";

// Deliberately use the real useColorScheme and ThemeProvider: mocking either
// hides a startup crash when RootLayout consumes the theme above its provider.
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue("dark"),
  removeItem: jest.fn().mockResolvedValue(undefined),
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
  useAuth: () => ({ isAuthenticated: false, isRestoring: false, sessionEpoch: 0 }),
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

it("starts with the real theme provider above every native color-scheme consumer", async () => {
  render(<RootLayout />);
  await waitFor(() => expect(screen.getByTestId("navigation-theme")).toBeTruthy());
  expect(screen.getByTestId("navigation-theme")).toHaveStyle({
    backgroundColor: Colors.dark.background,
  });
});
