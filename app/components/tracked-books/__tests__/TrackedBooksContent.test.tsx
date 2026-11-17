import { fireEvent, render } from "@testing-library/react-native";
import { TrackedBooksContent } from "../TrackedBooksContent";
let mockBooks: any[] = [];
let mockShelf: any = {};

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/context/auth", () => ({ useAuth: () => ({ authState: { did: "did:plc:self" } }) }));
jest.mock("@/hooks/queries/catalogueLists", () => ({
  useUserLists: () => ({ data: { lists: [{ uri: "at://reader/list/bees", name: "Bees" }] } }),
  useListDetails: (uri?: string) => (uri ? mockShelf : {}),
}));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({
  useRouter: () => jest.requireMock("expo-router").router,
  router: { push: jest.fn() },
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useProfile: () => ({ data: { books: mockBooks }, refetch: jest.fn() }),
}));
jest.mock("../TrackedBookItem", () => ({
  TrackedBookItem: ({ book }: any) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{book.title}</Text>;
  },
}));
jest.mock("@/components/QueryErrorHandler", () => ({ QueryErrorHandler: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
beforeEach(() => {
  mockBooks = [];
  mockShelf = {};
});

it("intersects public shelf membership with collection search without showing unrelated books while loading", async () => {
  mockBooks = [
    { hiveId: "bk_bee", title: "Bee book" },
    { hiveId: "bk_other", title: "Other book" },
  ];
  const result = await render(<TrackedBooksContent />);
  await fireEvent.press(result.getByText("Bees"));
  expect(result.queryByText("Other book")).toBeNull();
  expect(result.queryByText("Bee book")).toBeNull();
  mockShelf = { data: { items: [{ hiveId: "bk_bee" }] } };
  await result.rerender(<TrackedBooksContent />);
  expect(result.getByText("Bee book")).toBeTruthy();
  expect(result.queryByText("Other book")).toBeNull();
  await fireEvent.changeText(
    result.getByLabelText("Search your books by title or author"),
    "Other",
  );
  expect(result.queryByText("Bee book")).toBeNull();
  await fireEvent.press(result.getByText("Clear filters"));
  expect(result.getByText("Other book")).toBeTruthy();
});

it("lets long filter and sort labels wrap without shrinking the view-toggle target", async () => {
  const result = await render(<TrackedBooksContent />);
  await fireEvent.press(result.getByLabelText("Filter your books"));
  await fireEvent.press(result.getByText("Want to read (0)"));
  await fireEvent.press(result.getByLabelText("Filter your books"));
  await fireEvent.press(result.getByText("Only books I own"));
  const filter = result.getByLabelText("Filter your books");
  expect(filter).toHaveStyle({ maxWidth: "100%", flexShrink: 1, minHeight: 44 });
  expect(result.getByText(/Owned · 0/)).toHaveStyle({ flexShrink: 1 });
  expect(result.getByLabelText("Sort by Date added")).toHaveStyle({ flexShrink: 1, minHeight: 44 });
  expect(result.getByLabelText("Switch to grid view")).toHaveStyle({ minHeight: 44, minWidth: 44 });
});
