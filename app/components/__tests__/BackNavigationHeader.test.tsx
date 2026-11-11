/// <reference types="jest" />
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { BackNavigationHeader } from "../BackNavigationHeader";

const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, canGoBack: mockCanGoBack, navigate: mockNavigate }),
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "black" }));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => {
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return <Text>Back</Text>;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
});

it("renders a title and right-hand content", () => {
  render(
    <BackNavigationHeader title="Test Title" rightElement={<View testID="right-element" />} />,
  );
  expect(screen.getByText("Test Title")).toBeOnTheScreen();
  expect(screen.getByTestId("right-element")).toBeOnTheScreen();
});

it("exposes the full screen title as a heading without limiting large text to one line", () => {
  const title = "Reading statistics for a reader with a long name";
  render(<BackNavigationHeader title={title} />);
  const heading = screen.getByRole("header", { name: title });
  expect(heading.props.numberOfLines).toBeUndefined();
});

it("navigates back by default", () => {
  render(<BackNavigationHeader />);
  fireEvent.press(screen.getByText("Back"));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("uses a caller back handler instead of navigating", () => {
  const onBackPress = jest.fn();
  render(<BackNavigationHeader onBackPress={onBackPress} rightElement={<Text>Action</Text>} />);
  fireEvent.press(screen.getByText("Back"));
  expect(onBackPress).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
});

it("provides an accessible back action and returns direct links to Home", () => {
  mockCanGoBack.mockReturnValue(false);
  render(<BackNavigationHeader />);
  fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockNavigate).toHaveBeenCalledWith("/");
  expect(mockBack).not.toHaveBeenCalled();
});
