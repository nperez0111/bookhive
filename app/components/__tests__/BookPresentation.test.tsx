import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Text, View } from "react-native";
import MyBooksScreen from "../../app/(tabs)/my-books";
import StatusScreen from "../../app/books/[status]";
import ProfileScreen from "../../app/profile/[did]";
import { BookCard } from "../BookCard";
import { BOOK_STATUS } from "@/constants";

const mockPush = jest.fn();
const mockUpdate = jest.fn();
const mockProfile = jest.fn();
let mockPending = false;
const mockBooks = [
  {
    hiveId: "bk_a",
    title: "Earlier",
    authors: "One\tTwo",
    status: BOOK_STATUS.READING,
    stars: 9,
    owned: false,
    startedAt: "2026-01-01",
    genres: ["Fiction"],
  },
  {
    hiveId: "bk_b",
    title: "Later",
    authors: "Three",
    status: BOOK_STATUS.READING,
    stars: 7,
    owned: true,
    startedAt: "2026-02-01",
    genres: ["History"],
  },
];
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ status: "reading", did: "did:plc:other" }),
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useProfile: (...args: unknown[]) => {
    mockProfile(...args);
    return { data: { books: mockBooks, profile: { handle: "other.test" } } };
  },
  useUpdateBook: () => ({ mutateAsync: mockUpdate, isPending: mockPending }),
  useUserLists: () => ({}),
}));
jest.mock("@/context/auth", () => ({
  getBaseUrl: () => "https://bookhive.buzz",
  useAuth: () => ({ authState: { did: "did:plc:self" } }),
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#fff" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/BackNavigationHeader", () => ({ BackNavigationHeader: () => null }));
jest.mock("@/components/AnimatedListItem", () => ({
  AnimatedListItem: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/GradientView", () => ({
  GradientView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPending = false;
  mockUpdate.mockResolvedValue({ success: true });
});
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

test.each(["dense", "row"] as const)(
  "%s cards retain extra content and accessible navigation",
  (variant) => {
    render(
      <BookCard
        title="Example"
        authors="Writer"
        imageUri=""
        variant={variant}
        meta="Reading"
        onPress={mockPush}
      >
        <View testID="extra">
          <Text>Rated 4.5 out of 5</Text>
        </View>
      </BookCard>,
    );
    expect(screen.getByText("Reading")).toBeTruthy();
    expect(screen.getByTestId("extra")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Example" });
    expect(within(button).getByText("Writer")).toBeTruthy();
    expect(within(button).getByText("Reading")).toBeTruthy();
    expect(within(button).getByText("Rated 4.5 out of 5")).toBeTruthy();
    expect(button.props.accessibilityLabel).toBeUndefined();
    expect(button.props.accessibilityHint).toBe("Open book details");
    fireEvent.press(button);
    expect(mockPush).toHaveBeenCalledTimes(1);
  },
);

test("navigation-only cards preserve their label and expose changing metadata as a spoken value", () => {
  const view = render(
    <BookCard title="Example" authors="Writer" imageUri="" meta="Finished 2026-10-01" />,
  );
  expect(
    screen.getByRole("button", { name: "Open Example, by Writer" }).props.accessibilityValue,
  ).toEqual({ text: "Finished 2026-10-01" });
  view.rerender(<BookCard title="Example" authors="Writer" imageUri="" meta="Reading" />);
  expect(
    screen.getByRole("button", { name: "Open Example, by Writer" }).props.accessibilityValue,
  ).toEqual({ text: "Reading" });
});

test("My Books keeps status separate from navigation without per-book menus in list and grid modes", async () => {
  const { rerender } = render(<MyBooksScreen />);
  expect(screen.getByText("4.5")).toBeTruthy();
  expect(screen.queryByLabelText("More options for Earlier")).toBeNull();
  fireEvent.press(screen.getByLabelText("Change reading status for Earlier"));
  await act(async () => fireEvent.press(screen.getByText("Read")));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({
      hiveId: "bk_a",
      status: "buzz.bookhive.defs#finished",
    }),
  );
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText("Switch to grid view"));
  fireEvent.press(screen.getByRole("button", { name: "Earlier" }));
  expect(mockPush).toHaveBeenCalledWith("/book/bk_a");
  mockPending = true;
  rerender(<MyBooksScreen />);
  expect(screen.getByLabelText("Change reading status for Earlier")).toBeDisabled();
  expect(screen.queryByLabelText("More options for Earlier")).toBeNull();
});

test("status shelves retain another DID, genre filtering, start-date sorting and five-star ratings", async () => {
  render(<StatusScreen />);
  expect(mockProfile).toHaveBeenCalledWith("did:plc:other");
  expect(screen.getByText("4.5")).toBeTruthy();
  expect(screen.queryByText("0.9")).toBeNull();
  fireEvent.press(screen.getByText("Date Read"));
  expect(screen.UNSAFE_getAllByType(BookCard).map((card) => card.props.title)).toEqual([
    "Later",
    "Earlier",
  ]);
  fireEvent.press(screen.getByText("Fiction"));
  expect(screen.queryByText("Later")).toBeNull();
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Earlier" })));
  expect(mockPush).toHaveBeenCalledWith("/book/bk_a?status=reading");
});

test("public profile rows retain half-star ratings and book navigation", () => {
  render(<ProfileScreen />);
  expect(mockProfile).toHaveBeenCalledWith("did:plc:other");
  expect(screen.getByText("4.5")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Earlier" }));
  expect(mockPush).toHaveBeenCalledWith("/book/bk_a");
});
