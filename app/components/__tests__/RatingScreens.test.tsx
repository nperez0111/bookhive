import { render, screen } from "@testing-library/react-native";
import ReadingStatsScreen from "../../app/(tabs)/profile/[did]/stats";
import MyBooksScreen from "../../app/(tabs)/my-books";

let mockAllTime = false;
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
      showYearInBooks: !mockAllTime,
      allTimeStats: mockAllTime ? { ...mockStats, averageRating: 45 } : undefined,
      availableYears: [2026],
    },
  }),
  useProfile: () => ({
    data: { books: [{ hiveId: "bk_test", title: "Rated book", authors: "Author", stars: 9 }] },
  }),
  useUpdateBook: () => ({ isPending: false }),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ did: "did:plc:test" }),
  router: {},
}));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.buzz" }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#ffffff" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("@/components/BackNavigationHeader", () => ({ BackNavigationHeader: () => null }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/ActionSheet", () => ({ ActionSheet: () => null }));
jest.mock("@/components/QueryErrorHandler", () => ({ QueryErrorHandler: () => null }));
jest.mock("@/components/GradientView", () => ({
  GradientView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));

it("decodes the yearly fixed-point average rating", () => {
  mockAllTime = false;
  render(<ReadingStatsScreen />);
  expect(screen.getByText("4.2")).toBeTruthy();
  expect(screen.queryByText("42.0")).toBeNull();
});

it("decodes the all-time fallback fixed-point average rating", () => {
  mockAllTime = true;
  render(<ReadingStatsScreen />);
  expect(screen.getByText("All-Time Reading")).toBeTruthy();
  expect(screen.getByText("4.5")).toBeTruthy();
  expect(screen.queryByText("45.0")).toBeNull();
});

it("displays half-star user ratings in My Books on the five-star scale", () => {
  render(<MyBooksScreen />);
  expect(screen.getByText("4.5")).toBeTruthy();
  expect(screen.queryByText("0.9")).toBeNull();
});
