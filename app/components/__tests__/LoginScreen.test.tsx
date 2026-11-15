import { pressInFlight, submitInFlight } from "../../test/pressInFlight";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import LoginScreen from "@/app/(auth)/login";

const mockSignIn = jest.fn();
let mockParams: { handle?: string | string[] } = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock("@/context/auth", () => ({ useAuth: () => ({ signIn: mockSignIn }) }));
jest.mock("expo-router", () => ({
  useRouter: () => jest.requireMock("expo-router").router,
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: jest.fn(() => "dark") }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue();
  mockSignIn.mockResolvedValue(undefined);
});

it("requires a handle and offers account registration", async () => {
  await render(<LoginScreen />);
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Continue to sign in" })).toBeDisabled();
  await pressInFlight(screen.getByRole("button", { name: "Create an account" }));
  expect(router.push).toHaveBeenCalledWith("/(auth)/register");
});

it("prefills the requested handle before a remembered handle", async () => {
  mockParams = { handle: "reader.example.com" };
  await render(<LoginScreen />);
  await act(async () => {});
  expect(screen.getByDisplayValue("reader.example.com")).toBeOnTheScreen();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

it("does not overwrite typing when remembered-handle loading finishes", async () => {
  let resolve!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render(<LoginScreen />);
  await fireEvent.changeText(
    screen.getByLabelText("Bluesky or AT Protocol handle"),
    "new.example.com",
  );
  await act(async () => resolve("old.example.com"));
  expect(screen.getByDisplayValue("new.example.com")).toBeOnTheScreen();
});

it("submits once, trims the handle, and keeps failures recoverable", async () => {
  let reject!: (error: Error) => void;
  mockSignIn.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await render(<LoginScreen />);
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
  const input = screen.getByLabelText("Bluesky or AT Protocol handle");
  await fireEvent.changeText(input, " reader.example.com ");
  await submitInFlight(input, input);
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith({ handle: "reader.example.com" }));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Opening sign in" })).toBeDisabled();
  await act(async () => reject(new Error("Provider unavailable")));
  expect(screen.getByRole("alert")).toHaveTextContent("Provider unavailable");
  expect(screen.getByRole("button", { name: "Continue to sign in" })).toBeEnabled();
  await fireEvent.changeText(input, "other.example.com");
  expect(screen.queryByRole("alert")).toBeNull();
});
