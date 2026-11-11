import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import ReadingStatsScreen from "../../app/profile/[did]/stats";
import MyBooksScreen from "../../app/(tabs)/my-books";

const mockUpdateBook = jest.fn();
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});
const mockStats = {
  booksCount: 3,
  pagesRead: 300,
  averageRating: 42,
  ratingDistribution: { one: 0, two: 0, three: 0, four: 3, five: 0 },
  topGenres: [],
};
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useReadingStats: () => ({
    data: {
      stats: mockStats,
      showYearInBooks: false,
      allTimeStats: { ...mockStats, averageRating: 45 },
      availableYears: [2026],
    },
  }),
  useProfile: () => ({
    data: { books: [{ hiveId: "bk_test", title: "Rated book", authors: "Author", stars: 9 }] },
  }),
  useUpdateBook: () => ({ isPending: false, mutateAsync: mockUpdateBook }),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ did: "did:plc:test" }),
  router: { push: jest.fn() },
}));
jest.mock("@/context/auth", () => ({
  getBaseUrl: () => "https://bookhive.buzz",
  useAuth: () => ({ authState: { did: "did:plc:test" } }),
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#ffffff" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("@/components/BackNavigationHeader", () => ({ BackNavigationHeader: () => null }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/QueryErrorHandler", () => ({ QueryErrorHandler: () => null }));
jest.mock("@/components/GradientView", () => ({
  GradientView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));

it("decodes fixed-point ratings and shows all-time statistics only after explicit selection", () => {
  render(<ReadingStatsScreen />);
  expect(screen.queryByText("All-Time Reading")).toBeNull();
  expect(screen.getByText("4.2")).toBeTruthy();
  expect(screen.queryByText("42.0")).toBeNull();
  fireEvent.press(screen.getByText("All time"));
  expect(screen.getByText("All-Time Reading")).toBeTruthy();
  expect(screen.getByText("4.5")).toBeTruthy();
  expect(screen.queryByText("45.0")).toBeNull();
});

it("makes status the only row action without an ownership menu", async () => {
  mockUpdateBook.mockResolvedValue({});
  render(<MyBooksScreen />);
  expect(screen.queryByText("Own")).toBeNull();
  expect(screen.queryByText("Mark as owned")).toBeNull();
  fireEvent.press(screen.getByLabelText("Change reading status for Rated book"));
  await act(async () => fireEvent.press(screen.getByText("Reading")));
  expect(mockUpdateBook).toHaveBeenLastCalledWith({
    hiveId: "bk_test",
    status: "buzz.bookhive.defs#reading",
  });
  expect(screen.queryByLabelText("More options for Rated book")).toBeNull();
  fireEvent.press(screen.getByLabelText("Change reading status for Rated book"));
  await act(async () => fireEvent.press(screen.getByText("No status")));
  expect(mockUpdateBook).toHaveBeenLastCalledWith({ hiveId: "bk_test", status: "" });
});

it("keeps rejected row updates visible outside the book row", async () => {
  mockUpdateBook.mockRejectedValueOnce(new Error("Save failed"));
  render(<MyBooksScreen />);
  fireEvent.press(screen.getByLabelText("Change reading status for Rated book"));
  await act(async () => fireEvent.press(screen.getByText("Read")));
  expect(screen.getByText(/Save failed/)).toBeTruthy();
});

it("keeps library tools out of the book list until requested", () => {
  render(<MyBooksScreen />);
  expect(screen.queryByText("Shelves")).toBeNull();
  for (const [title, route] of [
    ["Shelves", "/lists"],
    ["Reading stats", "/profile/did:plc:test/stats"],
    ["Import", "/import"],
    ["Ebooks", "/library"],
  ]) {
    fireEvent.press(screen.getByLabelText("Library tools"));
    fireEvent.press(screen.getByText(title));
    expect(router.push).toHaveBeenLastCalledWith(route);
    expect(screen.queryByText(title)).toBeNull();
  }
});

it("keeps a catalogue entry point available when My Books already has books", () => {
  render(<MyBooksScreen />);
  fireEvent.press(screen.getByLabelText("Find books"));
  expect(router.push).toHaveBeenLastCalledWith("/search");
});

it("shows only the selected filter and keeps sorting options in a sheet", () => {
  render(<MyBooksScreen />);
  expect(screen.queryByText("Reading (0)")).toBeNull();
  fireEvent.press(screen.getByLabelText("Filter your books"));
  fireEvent.press(screen.getByText("Reading (0)"));
  expect(screen.getByText("Reading · 0")).toBeTruthy();
  expect(screen.getByText("No matching books")).toBeTruthy();
  fireEvent.press(screen.getByText("Clear filters"));
  expect(screen.getByText("Rated book")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Sort by Date added"));
  fireEvent.press(screen.getByText("Title"));
  fireEvent.press(screen.getByLabelText("Sort by Title"));
  fireEvent.press(screen.getByText("Ascending order"));
  expect(screen.queryByText("Sort your books")).toBeNull();
});
