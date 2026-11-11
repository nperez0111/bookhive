import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";
import FeedScreen from "../../app/feed";

const mockFeed = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), canGoBack: () => true, back: jest.fn() },
  useRouter: () => ({ canGoBack: () => true, back: jest.fn() }),
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useFeed: (...args: unknown[]) => mockFeed(...args),
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#1c1917" }));
jest.mock("@/hooks/useScreenTopInset", () => ({ useScreenTopInset: () => 0 }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.test" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockFeed.mockReturnValue({
    data: {
      pageParams: [undefined],
      pages: [
        {
          activities: [
            {
              userDid: "did:plc:reader",
              userHandle: "reader.test",
              hiveId: "bk_one",
              title: "Earthsea",
              authors: "Le Guin",
              status: "buzz.bookhive.defs#finished",
              indexedAt: "2026-10-01T00:00:00Z",
              stars: 9,
              review: "A wonderful voyage.",
            },
          ],
        },
      ],
    },
    refresh: jest.fn().mockResolvedValue(undefined),
    hasNextPage: false,
    isFetching: false,
    error: null,
    fetchNextPage: jest.fn(),
  });
});

test("feed book/profile actions are separate accessibility groups and activity remains spoken", () => {
  render(<FeedScreen />);
  const book = screen.getByRole("button", { name: "Open Earthsea, by Le Guin" });
  const profile = screen.getByRole("button", { name: "@reader.test" });
  expect(within(profile).getByText(/finished reading.*ago/)).toBeTruthy();
  expect(profile.props.accessibilityLabel).toBeUndefined();
  expect(within(book).queryByText("@reader.test")).toBeNull();
  expect(screen.getByLabelText("Rated 4.5 out of 5 stars")).toBeTruthy();
  expect(screen.getByText("A wonderful voyage.")).toBeTruthy();
  expect(within(book).queryByText("A wonderful voyage.")).toBeNull();
  fireEvent.press(profile);
  expect(router.push).toHaveBeenLastCalledWith("/profile/did:plc:reader");
  fireEvent.press(book);
  expect(router.push).toHaveBeenLastCalledWith("/book/bk_one");
});

test("feed filters expose selection and request the selected feed", () => {
  render(<FeedScreen />);
  expect(screen.getByRole("tab", { name: "Following" }).props.accessibilityState.selected).toBe(
    true,
  );
  fireEvent.press(screen.getByRole("tab", { name: "Your books" }));
  expect(mockFeed).toHaveBeenLastCalledWith("tracking");
  expect(screen.getByRole("tab", { name: "Your books" }).props.accessibilityState.selected).toBe(
    true,
  );
});
