import { Alert } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import AccountScreen from "../../app/(tabs)/account";

const mockDid = "did:plc:reader";
const mockDelete = jest.fn();
let mockProfile: { profile: { handle: string } } | undefined;
let mockDeletePending = false;
let mockResyncPending = false;

jest.mock("@/context/auth", () => ({
  useAuth: () => ({ authState: { did: mockDid, handle: "stored.test" } }),
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useProfile: () => ({ data: mockProfile }),
}));
jest.mock("@/hooks/useAccount", () => ({
  useDeleteAccount: () => ({ mutate: mockDelete, isPending: mockDeletePending }),
  useResyncBooks: () => ({ mutate: jest.fn(), isPending: mockResyncPending }),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/components/BackNavigationHeader", () => ({ BackNavigationHeader: () => null }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#ffffff" }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = undefined;
  mockDeletePending = false;
  mockResyncPending = false;
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test.each([false, true])(
  "DID confirmation is available with a stored handle and cached profile=%s",
  (cachedProfile) => {
    if (cachedProfile) mockProfile = { profile: { handle: "old.test" } };
    render(<AccountScreen />);
    expect(screen.getByText(/type your DID exactly: did:plc:reader/)).toBeTruthy();
    expect(
      screen.getByText(/accepts this fallback only when no profile is available/),
    ).toBeTruthy();
    if (!cachedProfile) expect(screen.getByText(/Your profile is unavailable/)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText("Confirm your handle or DID"), mockDid);
    fireEvent.press(screen.getAllByText("Delete BookHive data").at(-1)!);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const buttons = jest.mocked(Alert.alert).mock.calls[0][2]!;
    expect(buttons[0].style).toBe("cancel");
    expect(buttons[1].style).toBe("destructive");
    buttons[1].onPress!();
    expect(mockDelete).toHaveBeenCalledWith(mockDid);
  },
);

test("confirmation must exactly match a nonempty handle or DID", () => {
  mockProfile = { profile: { handle: "current.test" } };
  render(<AccountScreen />);
  const input = screen.getByLabelText("Confirm your handle or DID");
  for (const value of ["", "reader", "stored.test", "CURRENT.test", ` ${mockDid}`, `${mockDid} `]) {
    fireEvent.changeText(input, value);
    fireEvent.press(screen.getAllByText("Delete BookHive data").at(-1)!);
  }
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockDelete).not.toHaveBeenCalled();
  fireEvent.changeText(input, "current.test");
  fireEvent.press(screen.getAllByText("Delete BookHive data").at(-1)!);
  jest.mocked(Alert.alert).mock.calls[0][2]![1].onPress!();
  expect(mockDelete).toHaveBeenCalledWith("current.test");
});

test.each(["delete", "resync"])("pending %s blocks DID deletion", (pending) => {
  mockDeletePending = pending === "delete";
  mockResyncPending = pending === "resync";
  render(<AccountScreen />);
  fireEvent.changeText(screen.getByLabelText("Confirm your handle or DID"), mockDid);
  const label = mockDeletePending ? "Loading..." : "Delete BookHive data";
  fireEvent.press(screen.getAllByText(label).at(-1)!);
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockDelete).not.toHaveBeenCalled();
});
