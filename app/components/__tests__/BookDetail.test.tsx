/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import BookInfo from "../../app/(tabs)/book/[id]";
import { Modal } from "react-native";

const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockPush = jest.fn();
let mockDeleting = false;
let mockData: any;
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ id: "bk_test" }),
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useBookInfo: () => ({ data: mockData, isLoading: false }),
  useUpdateBook: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteBook: () => ({ mutateAsync: mockDelete, isPending: mockDeleting }),
}));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.buzz" }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#123456" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("react-native-reanimated", () => {
  const transition: any = {};
  for (const method of ["delay", "duration", "springify", "damping", "stiffness"])
    transition[method] = () => transition;
  return {
    __esModule: true,
    default: { View: jest.requireActual<typeof import("react-native")>("react-native").View },
    FadeInDown: transition,
    FadeInUp: transition,
    LinearTransition: transition,
  };
});
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/components/BackNavigationHeader", () => ({ BackNavigationHeader: () => null }));
jest.mock("@/components/AddToListSheet", () => ({ AddToListSheet: () => null }));
jest.mock("@/components/CommentsSection", () => ({ CommentsSection: () => null }));
jest.mock("@/components/StatusSelectionModal", () => ({ StatusSelectionModal: () => null }));
jest.mock("@/components/DatePickerModal", () => ({ DatePickerModal: () => null }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/UserBlock", () => ({ UserBlock: () => null }));
jest.mock("@/utils/htmlToText", () => ({ HtmlToText: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleting = false;
  mockUpdate.mockResolvedValue({ success: true });
  mockData = {
    book: { title: "Test Book", authors: "Author", genres: [] },
    comments: [],
    reviews: [],
    status: "buzz.bookhive.defs#reading",
    review: "Old review",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-02-01T00:00:00.000Z",
  };
});

it("sends boolean ownership", async () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByText("Own"));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ hiveId: "bk_test", owned: true }));
});

it("keeps empty review drafts distinct from untouched reviews", async () => {
  render(<BookInfo />);
  expect(screen.queryByText("Save Review")).toBeNull();
  fireEvent.changeText(screen.getByDisplayValue("Old review"), "");
  fireEvent.press(screen.getByText("Save Review"));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ hiveId: "bk_test", review: "" }));
});

it("shows rejected ownership saves", async () => {
  mockUpdate.mockRejectedValue(new Error("Save rejected"));
  render(<BookInfo />);
  fireEvent.press(screen.getByText("Own"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Save rejected"));
});

it("sends progress without the stale status, retaining exact pages", async () => {
  render(<BookInfo />);
  fireEvent.changeText(screen.getAllByPlaceholderText("Current")[0], "657");
  fireEvent.changeText(screen.getAllByPlaceholderText("Total")[0], "658");
  fireEvent.press(screen.getByText("Save progress"));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0][0]).toEqual({
    hiveId: "bk_test",
    bookProgress: expect.objectContaining({ currentPage: 657, totalPages: 658, percent: 100 }),
  });
  expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty("status");
});

it("does not save progress containing only an updatedAt timestamp", () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByText("Save progress"));
  expect(screen.getByText("Enter at least one progress metric before saving.")).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("preserves progress drafts through unrelated updates but follows canonical replacement", () => {
  mockData.bookProgress = { currentPage: 10, totalPages: 100, percent: 10 };
  const { rerender } = render(<BookInfo />);
  fireEvent.changeText(screen.getAllByPlaceholderText("Current")[0], "20");
  mockData = { ...mockData, owned: true };
  rerender(<BookInfo />);
  expect(screen.getAllByPlaceholderText("Current")[0].props.value).toBe("20");
  mockData = { ...mockData, bookProgress: { currentPage: 11, totalPages: 100, percent: 11 } };
  rerender(<BookInfo />);
  expect(screen.getAllByPlaceholderText("Current")[0].props.value).toBe("11");
});

it("preserves exact chapter counts when the rounded percentage is 100", async () => {
  render(<BookInfo />);
  fireEvent.changeText(screen.getAllByPlaceholderText("Current")[1], "299");
  fireEvent.changeText(screen.getAllByPlaceholderText("Total")[1], "300");
  fireEvent.press(screen.getByText("Save progress"));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0][0]).toEqual({
    hiveId: "bk_test",
    bookProgress: expect.objectContaining({
      currentChapter: 299,
      totalChapters: 300,
      percent: 100,
    }),
  });
});

it("clears every draft field when canonical progress is removed", () => {
  mockData.bookProgress = {
    currentPage: 10,
    totalPages: 100,
    currentChapter: 1,
    totalChapters: 10,
    percent: 10,
  };
  const { rerender } = render(<BookInfo />);
  fireEvent.changeText(screen.getAllByPlaceholderText("Current")[0], "20");
  mockData = { ...mockData, bookProgress: undefined };
  rerender(<BookInfo />);
  for (const input of [
    ...screen.getAllByPlaceholderText("Current"),
    ...screen.getAllByPlaceholderText("Total"),
  ]) {
    expect(input.props.value).toBe("");
  }
  expect(screen.getByPlaceholderText("Auto-calculated").props.value).toBe("");
});

it("keeps manual percent and intentional emptiness until a metric edit restores automatic calculation", async () => {
  render(<BookInfo />);
  fireEvent.changeText(screen.getAllByPlaceholderText("Current")[0], "10");
  fireEvent.changeText(screen.getAllByPlaceholderText("Total")[0], "100");
  expect(screen.getByPlaceholderText("Auto-calculated").props.value).toBe("10");
  fireEvent.changeText(screen.getByPlaceholderText("Auto-calculated"), "35");
  fireEvent.press(screen.getByText("Save progress"));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({
      hiveId: "bk_test",
      bookProgress: expect.objectContaining({ percent: 35 }),
    }),
  );
  fireEvent.changeText(screen.getByPlaceholderText("Auto-calculated"), "");
  expect(screen.getByPlaceholderText("Auto-calculated").props.value).toBe("");
  fireEvent.changeText(screen.getAllByPlaceholderText("Current")[0], "20");
  expect(screen.getByPlaceholderText("Auto-calculated").props.value).toBe("20");
});

it("rejects invalid progress rather than silently discarding it", () => {
  render(<BookInfo />);
  fireEvent.changeText(screen.getAllByPlaceholderText("Current")[0], "-1");
  fireEvent.press(screen.getByText("Save progress"));
  expect(screen.getByText("Pages read must be a positive whole number.")).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("clears dates with API empty strings and clears status without deleting the record", async () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Clear started date"));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({ hiveId: "bk_test", startedAt: "" }),
  );
  fireEvent.press(screen.getByLabelText("Clear finished date"));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({ hiveId: "bk_test", finishedAt: "" }),
  );
  fireEvent.press(screen.getByText("Clear reading status"));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ hiveId: "bk_test", status: "" }));
  expect(mockDelete).not.toHaveBeenCalled();
});

it("retains failed deletion confirmation and makes its error visible", async () => {
  mockDelete.mockRejectedValue(new Error("Delete rejected"));
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Delete book tracking"));
  fireEvent.press(screen.getByText("Delete"));
  await waitFor(() => expect(screen.getAllByText("Delete rejected").length).toBeGreaterThan(0));
  expect(screen.getByText("Delete Book")).toBeTruthy();
  expect(screen.getByDisplayValue("Old review")).toBeTruthy();
});

it("links public shelves to the catalogue list route", () => {
  mockData.shelves = [
    {
      uri: "at://did:plc:other/social.popfeed.feed.list/abc",
      name: "Favorites",
      userDid: "did:plc:other",
      itemUri: "at://item",
    },
  ];
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("View public shelf Favorites"));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/lists/[uri]",
    params: { uri: encodeURIComponent(mockData.shelves[0].uri) },
  });
});

it("leaves tracking and confirmation visible while deletion is pending, blocking edits", async () => {
  let finishDelete!: (value: unknown) => void;
  mockDelete.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
  );
  const { rerender } = render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Delete book tracking"));
  fireEvent.press(screen.getByText("Delete"));
  mockDeleting = true;
  rerender(<BookInfo />);
  expect(screen.getByText("Delete Book")).toBeTruthy();
  expect(screen.getByDisplayValue("Old review")).toBeTruthy();
  for (const label of ["Pages read", "Total pages", "Chapters read", "Total chapters"]) {
    expect(screen.getByLabelText(label)).toHaveProp("editable", false);
  }
  fireEvent.press(screen.getByText("Own"));
  fireEvent.press(screen.getByText("Save progress"));
  fireEvent.press(screen.getByText("Cancel"));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.getByText("Delete Book")).toBeTruthy();
  finishDelete({ success: true });
  await waitFor(() => expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false));
});
