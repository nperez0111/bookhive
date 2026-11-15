import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import ReaderProfileScreen from "../profile/ReaderProfileScreen";
import { BOOK_STATUS } from "@/constants";

const mockFollow = jest.fn();
const mockRefetch = jest.fn().mockResolvedValue({});
const mockRefetchLists = jest.fn().mockResolvedValue({});
let mockListsLoading = false;
let mockListsError: Error | null = null;
let mockListsData = true;
let mockDescription: string | undefined;
let mockError: Error | null;
const mockBooks = Array.from({ length: 5 }, (_, i) => ({
  hiveId: `bk_${i}`,
  title: `Book ${i}`,
  authors: "An Author",
  status: BOOK_STATUS.READING,
  stars: 9,
  review: `<b>Review ${i}</b><br/>More &amp; detail`,
}));

jest.mock("expo-router", () => ({
  useRouter: () => jest.requireMock("expo-router").router,
  router: { push: jest.fn() },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#ffffff" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 50 }));
jest.mock("@/context/auth", () => ({
  useAuth: () => ({ authState: { did: "did:plc:viewer" } }),
  getBaseUrl: () => "https://bookhive.buzz",
}));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/QueryErrorHandler", () => ({ QueryErrorHandler: () => null }));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useProfile: () => ({
    data: {
      profile: {
        displayName: "Reader",
        handle: "reader.test",
        description: mockDescription,
        reviews: 5,
        isFollowing: false,
      },
      books: mockBooks,
    },
    refetch: mockRefetch,
    error: mockError,
  }),
  useUserLists: () => ({
    refetch: mockRefetchLists,
    isLoading: mockListsLoading,
    error: mockListsError,
    data: mockListsData
      ? {
          lists: Array.from({ length: 5 }, (_, i) => ({
            uri: `at://shelf/${i}`,
            name: `Shelf ${i}`,
            itemCount: i,
          })),
        }
      : undefined,
  }),
  useFollow: () => ({ mutate: mockFollow }),
  useUnfollow: () => ({ mutate: jest.fn() }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockError = null;
  mockListsLoading = false;
  mockListsError = null;
  mockListsData = true;
  mockDescription = "A reader of books.\n\nA longer biography with links and more details.";
});

it("refreshes profile and public shelves together, retaining cached shelves on failure", async () => {
  mockListsError = new Error("Offline");
  const screen = await render(<ReaderProfileScreen did="did:plc:viewer" />);
  expect(screen.getByText("Shelf 0")).toBeTruthy();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load public shelves.");
  const refresh = screen.container.queryAll((node) => node.type === "RCTRefreshControl")[0];
  await fireEvent(refresh, "refresh");
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(mockRefetchLists).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Retry public shelves" }));
  expect(mockRefetchLists).toHaveBeenCalledTimes(2);
});

it("separates shelf loading and failed requests from an empty successful response", async () => {
  mockListsData = false;
  mockListsLoading = true;
  const screen = await render(<ReaderProfileScreen did="did:plc:viewer" />);
  expect(screen.getByText("Loading public shelves…")).toBeTruthy();
  mockListsLoading = false;
  mockListsError = new Error("Offline");
  await screen.rerender(<ReaderProfileScreen did="did:plc:viewer" />);
  expect(screen.queryByText("Loading public shelves…")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry public shelves" })).toBeTruthy();
  expect(screen.getByText("Reader")).toBeTruthy();
});

it("keeps only the bio introduction visible until expanded", async () => {
  const screen = await render(<ReaderProfileScreen did="did:plc:viewer" inProfileTab />);
  expect(screen.getByText("A reader of books.")).toBeTruthy();
  expect(screen.queryByText(mockDescription!)).toBeNull();
  const more = screen.getByLabelText("Show full bio");
  expect(more.props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(more);
  expect(screen.getByText(mockDescription!)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Show less bio"));
  expect(screen.getByText("A reader of books.")).toBeTruthy();
});

it("does not add placeholder bio text or expansion controls for short bios", async () => {
  mockDescription = "Short bio";
  const screen = await render(<ReaderProfileScreen did="did:plc:viewer" />);
  expect(screen.getByText("Short bio")).toBeTruthy();
  expect(screen.queryByLabelText("Show full bio")).toBeNull();
  mockDescription = undefined;
  await screen.rerender(<ReaderProfileScreen did="did:plc:viewer" />);
  expect(screen.queryByText("No bio available")).toBeNull();
});

it("bounds book and review previews without hiding the full collections", async () => {
  const screen = await render(<ReaderProfileScreen did="did:plc:viewer" />);
  expect(
    screen
      .getAllByRole("button", { name: /^Book \d\b/ })
      .filter((button) => button.props.accessibilityHint === "Open book details"),
  ).toHaveLength(3);
  expect(screen.queryAllByLabelText(/Read review of/)).toHaveLength(2);
  expect(screen.getByText("Review 0 More & detail")).toBeTruthy();
  expect(screen.queryByText(/<b>Review/)).toBeNull();
  await fireEvent.press(screen.getByLabelText("View currently reading books"));
  expect(router.push).toHaveBeenLastCalledWith("/books/reading?did=did:plc:viewer");
  await fireEvent.press(screen.getByLabelText("View reading stats"));
  expect(router.push).toHaveBeenLastCalledWith("/profile/did:plc:viewer/stats");
  await fireEvent.press(screen.getByText("All 5 reviews"));
  expect(screen.getAllByLabelText(/Read review of/)).toHaveLength(5);
  await fireEvent.press(screen.getByLabelText("Read review of Book 4"));
  expect(router.push).toHaveBeenLastCalledWith("/book/bk_4");
  await fireEvent.press(screen.getByText("Fewer reviews"));
  expect(screen.getAllByLabelText(/Read review of/)).toHaveLength(2);
});

it("keeps public shelves reachable beyond the compact preview", async () => {
  const screen = await render(<ReaderProfileScreen did="did:plc:viewer" />);
  expect(screen.queryByText("Shelf 4")).toBeNull();
  await fireEvent.press(screen.getByText("All 5 shelves"));
  await fireEvent.press(screen.getByText("Shelf 4"));
  expect(router.push).toHaveBeenLastCalledWith("/lists/at%3A%2F%2Fshelf%2F4");
});

it("preserves follow actions on other readers and cached content after refresh errors", async () => {
  mockError = new Error("Offline");
  const screen = await render(<ReaderProfileScreen did="did:plc:other" />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByText("Reader")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Follow reader"));
  expect(mockFollow).toHaveBeenCalledWith({ did: "did:plc:other" }, expect.any(Object));
});
