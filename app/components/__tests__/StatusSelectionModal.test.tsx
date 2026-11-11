import { fireEvent, render, screen } from "@testing-library/react-native";
import { BOOK_STATUS } from "@/constants/index";
import { StatusSelectionModal } from "../StatusSelectionModal";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: jest.requireActual<typeof import("react-native")>("react-native").View,
  useSafeAreaInsets: () => ({ top: 20, bottom: 20 }),
}));

it("exposes the selected status and close action, replacing options while pending", () => {
  const props = {
    visible: true,
    onClose: jest.fn(),
    currentStatus: BOOK_STATUS.READING,
    onStatusSelect: jest.fn(),
    isPending: false,
  };
  const result = render(<StatusSelectionModal {...props} />);
  expect(screen.getByRole("radio", { checked: true })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Close reading status" }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  result.rerender(<StatusSelectionModal {...props} isPending />);
  expect(screen.getByText("Updating your reading status...")).toBeOnTheScreen();
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
});
