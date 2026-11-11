import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import MyProfileScreen from "../../app/(tabs)/me";
import SettingsScreen from "../../app/settings";
import ReaderProfileScreen from "@/components/profile/ReaderProfileScreen";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-updates", () => ({}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/context/auth", () => ({
  useAuth: () => ({ authState: { did: "did:plc:viewer" }, signOut: jest.fn() }),
}));
jest.mock("@/context/language", () => ({
  useLanguage: () => ({ preferredLanguage: "en", setPreferredLanguage: jest.fn() }),
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({ useLanguages: () => ({ data: [] }) }));
jest.mock("@/components/profile/ReaderProfileScreen", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock("@/components/LanguagePicker", () => ({ LanguagePicker: () => null }));
jest.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

beforeEach(() => jest.clearAllMocks());

it("shows the viewer's public profile and a separate settings gear", () => {
  const screen = render(<MyProfileScreen />);
  expect(ReaderProfileScreen).toHaveBeenCalledWith(
    { did: "did:plc:viewer", inProfileTab: true },
    undefined,
  );
  fireEvent.press(screen.getByLabelText("Settings"));
  expect(router.push).toHaveBeenCalledWith("/settings");
  expect(screen.queryByText("Sign Out")).toBeNull();
});

it("keeps account tools in settings, not reading tools", () => {
  const screen = render(<SettingsScreen />);
  expect(screen.getByText("Book Language")).toBeTruthy();
  expect(screen.getByText("Sign Out")).toBeTruthy();
  expect(screen.getByText("Privacy Policy")).toBeTruthy();
  fireEvent.press(screen.getByText("Account Management"));
  expect(router.push).toHaveBeenCalledWith("/account");
  for (const title of [
    "My Books",
    "Shelves",
    "Ebooks",
    "Import Books",
    "Reading Stats",
    "E-Reader Sync",
  ]) {
    expect(screen.queryByText(title)).toBeNull();
  }
});
