/// <reference types="jest" />
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { BackNavigationHeader } from "../BackNavigationHeader";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "black" }));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => {
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return <Text>Back</Text>;
  },
}));

beforeEach(() => jest.clearAllMocks());

it("renders a title and right-hand content", () => {
  render(
    <BackNavigationHeader title="Test Title" rightElement={<View testID="right-element" />} />,
  );
  expect(screen.getByText("Test Title")).toBeOnTheScreen();
  expect(screen.getByTestId("right-element")).toBeOnTheScreen();
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
