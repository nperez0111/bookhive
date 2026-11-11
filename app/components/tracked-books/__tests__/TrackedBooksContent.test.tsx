import { fireEvent, render } from "@testing-library/react-native";
import { TrackedBooksContent } from "../TrackedBooksContent";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useProfile: () => ({ data: { books: [] }, refetch: jest.fn() }),
}));
jest.mock("../TrackedBookItem", () => ({ TrackedBookItem: () => null }));
jest.mock("@/components/QueryErrorHandler", () => ({ QueryErrorHandler: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

it("lets long filter and sort labels wrap without shrinking the view-toggle target", () => {
  const result = render(<TrackedBooksContent />);
  fireEvent.press(result.getByLabelText("Filter your books"));
  fireEvent.press(result.getByText("Want to read (0)"));
  fireEvent.press(result.getByLabelText("Filter your books"));
  fireEvent.press(result.getByText("Only books I own"));
  const filter = result.getByLabelText("Filter your books");
  expect(filter).toHaveStyle({ maxWidth: "100%", flexShrink: 1, minHeight: 44 });
  expect(result.getByText(/Owned · 0/)).toHaveStyle({ flexShrink: 1 });
  expect(result.getByLabelText("Sort by Date added")).toHaveStyle({ flexShrink: 1, minHeight: 44 });
  expect(result.getByLabelText("Switch to grid view")).toHaveStyle({ minHeight: 44, minWidth: 44 });
});
