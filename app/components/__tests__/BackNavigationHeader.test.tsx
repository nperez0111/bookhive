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

it("renders a title and right-hand content", async () => {
  await render(
    <BackNavigationHeader
      title="Test Title"
      subtitle="Book author"
      rightElement={<View testID="right-element" />}
    />,
  );
  expect(screen.getByText("Test Title")).toBeOnTheScreen();
  expect(screen.getByText("Book author")).toBeOnTheScreen();
  expect(screen.getByTestId("right-element")).toBeOnTheScreen();
});

it("exposes the full screen title as a heading without limiting large text to one line", async () => {
  const title = "Reading statistics for a reader with a long name";
  await render(<BackNavigationHeader title={title} />);
  const heading = screen.getByRole("header", { name: title });
  expect(heading.props.numberOfLines).toBeUndefined();
});

it("can center a book title and author", async () => {
  await render(<BackNavigationHeader title="Dune" subtitle="Frank Herbert" centered />);
  expect(screen.getByRole("header", { name: "Dune" })).toHaveStyle({ textAlign: "center" });
  expect(screen.getByText("Frank Herbert")).toHaveStyle({ textAlign: "center" });
});

it("navigates back by default", async () => {
  await render(<BackNavigationHeader />);
  await fireEvent.press(screen.getByText("Back"));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("uses a caller back handler instead of navigating", async () => {
  const onBackPress = jest.fn();
  await render(
    <BackNavigationHeader onBackPress={onBackPress} rightElement={<Text>Action</Text>} />,
  );
  await fireEvent.press(screen.getByText("Back"));
  expect(onBackPress).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
});

it("provides an accessible back action and returns direct links to Home", async () => {
  mockCanGoBack.mockReturnValue(false);
  await render(<BackNavigationHeader />);
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockNavigate).toHaveBeenCalledWith("/");
  expect(mockBack).not.toHaveBeenCalled();
});
