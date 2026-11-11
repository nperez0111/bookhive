import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import HomeScreen from "../../app/(tabs)/index";
import { BOOK_STATUS } from "@/constants";

let mockBooks: any[] = [];
let mockError: Error | null = null;
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#fff" }));
jest.mock("@/context/auth", () => ({
  useAuth: () => ({ authState: { did: "did:plc:self" } }),
  getBaseUrl: () => "https://bookhive.buzz",
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useProfile: () => ({
    data: { books: mockBooks, profile: { handle: "reader.test" }, activity: [] },
    error: mockError,
  }),
  useUserLists: () => ({ data: { lists: [] } }),
  usePersonalLibrary: () => ({}),
}));
jest.mock("@/components/CreateListModal", () => ({ CreateListModal: () => null }));
jest.mock("@/components/AnimatedListItem", () => ({
  AnimatedListItem: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/GradientView", () => ({
  GradientView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));

beforeEach(() => {
  mockBooks = [];
  mockError = null;
  jest.clearAllMocks();
});

it("limits book previews and keeps the complete reading shelf one tap away", () => {
  mockBooks = Array.from({ length: 8 }, (_, index) => ({
    hiveId: `bk_${index}`,
    title: `Book ${index}`,
    authors: "Writer",
    status: BOOK_STATUS.READING,
  }));
  render(<HomeScreen />);
  expect(screen.getByText("Book 3")).toBeTruthy();
  expect(screen.queryByText("Book 4")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "See all currently reading books, 8 books" }));
  expect(router.push).toHaveBeenLastCalledWith("/books/reading");
});

it("gives empty reading sections an action and sends time-based stats to reading stats", () => {
  render(<HomeScreen />);
  fireEvent.press(screen.getAllByText("Find a book")[0]);
  expect(router.push).toHaveBeenLastCalledWith("/search");
  fireEvent.press(screen.getByText("This Year"));
  expect(router.push).toHaveBeenLastCalledWith("/profile/did:plc:self/stats");
});

it("keeps cached books available when refresh fails", () => {
  mockBooks = [
    { hiveId: "bk_a", title: "Cached book", authors: "Writer", status: BOOK_STATUS.READING },
  ];
  mockError = new Error("Offline");
  render(<HomeScreen />);
  expect(screen.getByText("Cached book")).toBeTruthy();
  expect(screen.getByRole("alert")).toHaveTextContent(/Could not refresh/);
});

it("previews finished books in finish-date order instead of duplicating the owned collection", () => {
  mockBooks = [
    {
      hiveId: "bk_old",
      title: "Earlier finish",
      status: BOOK_STATUS.FINISHED,
      finishedAt: "2026-01-01",
    },
    {
      hiveId: "bk_new",
      title: "Latest finish",
      status: BOOK_STATUS.FINISHED,
      finishedAt: "2026-10-01",
    },
    { hiveId: "bk_owned", title: "Only owned", owned: true },
  ];
  render(<HomeScreen />);
  const books = screen
    .getAllByRole("button")
    .filter((button) => button.props.accessibilityLabel?.startsWith("Open "));
  expect(books.map((book) => book.props.accessibilityLabel)).toEqual([
    "Open Latest finish, by Unknown author",
    "Open Earlier finish, by Unknown author",
  ]);
  expect(screen.queryByText("Only owned")).toBeNull();
});
