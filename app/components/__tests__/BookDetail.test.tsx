/// <reference types="jest" />
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import BookInfo from "../../app/book/[id]";
import { Modal, Text } from "react-native";
import { Colors } from "@/constants/Colors";
import { BookActionCard } from "../BookActionCard";

const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockPush = jest.fn();
let mockDeleting = false;
let mockData: any;
let mockTheme: "light" | "dark" = "light";
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
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => mockTheme }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#123456" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("react-native-reanimated", () => {
  const transition: any = {};
  for (const method of ["delay", "duration", "springify", "damping", "stiffness", "reduceMotion"])
    transition[method] = () => transition;
  return {
    __esModule: true,
    default: { View: jest.requireActual<typeof import("react-native")>("react-native").View },
    FadeInDown: transition,
    FadeInUp: transition,
    LinearTransition: transition,
    ReduceMotion: { System: "system" },
  };
});
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/components/BackNavigationHeader", () => ({ BackNavigationHeader: () => null }));
jest.mock("@/components/AddToListSheet", () => ({ AddToListSheet: () => null }));
jest.mock("@/components/CommentsSection", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View, TextInput } = jest.requireActual<typeof import("react-native")>("react-native");
  function Entry({ id }: { id: string }) {
    const [draft, setDraft] = React.useState("");
    return (
      <TextInput accessibilityLabel={`Comment draft ${id}`} value={draft} onChangeText={setDraft} />
    );
  }
  return {
    CommentsSection: ({ comments }: { comments: { id: string }[] }) => (
      <View>
        {comments.map(({ id }) => (
          <Entry key={id} id={id} />
        ))}
      </View>
    ),
  };
});
jest.mock("@/components/StatusSelectionModal", () => ({ StatusSelectionModal: () => null }));
jest.mock("@/components/DatePickerModal", () => ({ DatePickerModal: () => null }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/UserBlock", () => ({ UserBlock: () => null }));
jest.mock("@/utils/htmlToText", () => ({ HtmlToText: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleting = false;
  mockTheme = "light";
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

it("keeps comment/review drafts attached to record URIs after insertions and reorder", () => {
  const first = {
    uri: "at://comment/first",
    did: "did:plc:a",
    createdAt: "2026-01-01",
    parent: { uri: "at://book" },
    comment: "First",
  };
  const second = { ...first, uri: "at://comment/second", comment: "Second" };
  const review = {
    uri: "at://review/a",
    did: "did:plc:a",
    createdAt: "2026-01-01",
    review: "Review",
  };
  mockData = { ...mockData, comments: [first, second], reviews: [review] };
  const result = render(<BookInfo />);
  fireEvent.changeText(screen.getByLabelText("Comment draft at://comment/first"), "First draft");
  fireEvent.changeText(screen.getByLabelText("Comment draft at://review/a"), "Review draft");
  mockData = {
    ...mockData,
    comments: [{ ...first, uri: "at://comment/new" }, second, first],
    reviews: [{ ...review, uri: "at://review/new" }, review],
  };
  result.rerender(<BookInfo />);
  expect(screen.getByLabelText("Comment draft at://comment/first")).toHaveProp(
    "value",
    "First draft",
  );
  expect(screen.getByLabelText("Comment draft at://review/a")).toHaveProp("value", "Review draft");
  expect(screen.getByLabelText("Comment draft at://comment/new")).toHaveProp("value", "");
  expect(screen.getByLabelText("Comment draft at://comment/second")).toHaveProp("value", "");
});

it("uses deterministic fallback identities for records without URIs", () => {
  const first = {
    did: "did:plc:a",
    createdAt: "2026-01-01",
    parent: { uri: "at://book" },
    comment: "First",
  };
  const second = { ...first, did: "did:plc:b" };
  mockData = {
    ...mockData,
    comments: [first, second],
    reviews: [{ did: "did:plc:a", review: "Old" }],
  };
  const result = render(<BookInfo />);
  const firstInput = screen.getAllByLabelText(/^Comment draft comment:/)[0];
  const label = firstInput.props.accessibilityLabel;
  fireEvent.changeText(firstInput, "Keep this comment draft");
  fireEvent.changeText(
    screen.getByLabelText("Comment draft review:did:plc:a"),
    "Keep this review draft",
  );
  mockData = {
    ...mockData,
    comments: [second, first],
    reviews: [{ did: "did:plc:a", review: "Updated" }],
  };
  result.rerender(<BookInfo />);
  expect(screen.getByLabelText(label)).toHaveProp("value", "Keep this comment draft");
  expect(screen.getByLabelText("Comment draft review:did:plc:a")).toHaveProp(
    "value",
    "Keep this review draft",
  );
});

it("lets catalogue rating metadata reflow at accessibility text sizes without truncating or shrinking text", () => {
  mockData.book.rating = 4300;
  mockData.book.ratingsCount = 1721972;
  render(<BookInfo />);
  const metadata = screen.getByText("4.3 (1,721,972)");
  expect(metadata).toHaveStyle({ fontSize: 14, flexShrink: 1, maxWidth: "100%" });
  expect(metadata.props.numberOfLines).toBeUndefined();
  expect(metadata.props.allowFontScaling).not.toBe(false);
  expect(metadata.props.adjustsFontSizeToFit).not.toBe(true);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it.each(["light", "dark"] as const)("uses themed, readable detail controls in %s mode", (theme) => {
  mockTheme = theme;
  mockData.book.description = "Description";
  mockData.book.genres = ["Fantasy"];
  render(<BookInfo />);
  expect(screen.getByText("No progress recorded")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Share book" })).toHaveStyle({
    minHeight: 44,
  });
  expect(screen.getByRole("button", { name: "Add to List" })).toHaveStyle({
    minHeight: 44,
  });
  expect(screen.getByText("Read full description")).toHaveStyle({
    color: Colors[theme].text,
  });
  expect(screen.getByText("Fantasy")).toHaveStyle({ color: Colors[theme].text });
  fireEvent.press(screen.getByLabelText("Update reading progress"));
  for (const label of ["Pages read", "Total pages", "Chapters read", "Total chapters", "Percent"]) {
    expect(screen.getByText(label)).toHaveStyle({
      color: Colors[theme].secondaryText,
    });
  }
  expect(screen.getByRole("button", { name: "Save progress" })).toHaveStyle({
    backgroundColor: Colors[theme].primary,
    minHeight: 44,
  });
  expect(screen.getByText("Save progress")).toHaveStyle({ color: Colors.light.primaryText });
  fireEvent.press(screen.getByRole("button", { name: "Save progress" }));
  expect(screen.getByRole("alert")).toHaveStyle({ color: Colors[theme].errorText });
  expect(screen.getByLabelText("Pages read")).toHaveStyle({
    minHeight: 44,
    borderColor: Colors[theme].tertiaryText,
  });
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("keeps personal reading controls together before sharing and catalogue content", () => {
  const result = render(<BookInfo />);
  const text = result.UNSAFE_getAllByType(Text).map((node) => node.props.children);
  const ordered = [
    "Reading status",
    "Reading progress",
    "Rate this book",
    "Your Review",
    "Reading Dates",
    "Clear reading status",
    "Share",
    "Description",
    "Remove from My Books",
  ];
  for (let i = 1; i < ordered.length; i++) {
    expect(text.indexOf(ordered[i])).toBeGreaterThan(text.indexOf(ordered[i - 1]));
  }
  expect(screen.getByRole("button", { name: "reading" })).toBeTruthy();
  expect(screen.getByLabelText("Delete book tracking")).toHaveStyle({
    minHeight: 44,
    borderWidth: 1,
  });
  for (const label of [
    "Update reading progress",
    "Edit rating",
    "Edit review",
    "Edit reading dates",
  ]) {
    expect(screen.getByLabelText(label).props.accessibilityState.expanded).toBe(false);
    expect(screen.getByLabelText(label)).toHaveStyle({ minHeight: 44 });
  }
});

it.each(["light", "dark"] as const)(
  "makes unset status primary and ownership an outlined switch in %s",
  (theme) => {
    mockTheme = theme;
    mockData = { book: mockData.book, comments: [], reviews: [] };
    render(<BookInfo />);
    expect(screen.getByRole("button", { name: "Choose reading status" })).toHaveStyle({
      backgroundColor: Colors[theme].primary,
    });
    expect(screen.getByText("Choose reading status")).toHaveStyle({
      color: Colors.light.primaryText,
    });
    expect(screen.getByRole("switch", { name: "Own this book", checked: false })).toHaveStyle({
      minHeight: 44,
      minWidth: 44,
    });
    expect(screen.queryByLabelText("Edit reading dates")).toBeNull();
  },
);

it("retains every open disclosure and both drafts through an unrelated canonical update", () => {
  const { rerender } = render(<BookInfo />);
  for (const label of [
    "Update reading progress",
    "Edit rating",
    "Edit review",
    "Edit reading dates",
  ])
    fireEvent.press(screen.getByLabelText(label));
  fireEvent.changeText(screen.getByLabelText("Pages read"), "23");
  fireEvent.changeText(screen.getByLabelText("Your review"), "Unsaved review");
  mockData = { ...mockData, owned: true };
  rerender(<BookInfo />);
  for (const label of [
    "Update reading progress",
    "Edit rating",
    "Edit review",
    "Edit reading dates",
  ])
    expect(screen.getByLabelText(label).props.accessibilityState.expanded).toBe(true);
  for (const label of ["Update reading progress", "Edit review"])
    fireEvent.press(screen.getByLabelText(label));
  for (const label of ["Update reading progress", "Edit review"])
    fireEvent.press(screen.getByLabelText(label));
  expect(screen.getByLabelText("Pages read").props.value).toBe("23");
  expect(screen.getByLabelText("Your review").props.value).toBe("Unsaved review");
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("keeps editors closed until requested and expands the book description", () => {
  mockData.book.description = "A book description.";
  render(<BookInfo />);
  expect(screen.queryByPlaceholderText("Current")).toBeNull();
  expect(screen.queryByDisplayValue("Old review")).toBeNull();
  expect(screen.getByLabelText("Edit review").props.accessibilityState.expanded).toBe(false);
  fireEvent.press(screen.getByText("Read full description"));
  expect(screen.getByText("Show less")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Update reading progress"));
  expect(screen.getAllByPlaceholderText("Current")).toHaveLength(2);
  fireEvent.press(screen.getByLabelText("Edit review"));
  expect(screen.getByDisplayValue("Old review")).toBeTruthy();
});

it("sends boolean ownership", async () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByText("Own"));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ hiveId: "bk_test", owned: true }));
});

it.each([true, false])(
  "returns the awaited date-save result (%s) to the picker",
  async (success) => {
    if (!success) mockUpdate.mockRejectedValue(new Error("Date rejected"));
    const result = render(<BookInfo />);
    const dates = result
      .UNSAFE_getAllByType(BookActionCard)
      .find((card) => card.props.type === "dates")!;
    let saved: boolean | undefined;
    await act(async () => {
      saved = await dates.props.onStartedAtChange("2026-01-02");
    });
    expect(saved).toBe(success);
    expect(mockUpdate).toHaveBeenCalledWith({ hiveId: "bk_test", startedAt: "2026-01-02" });
  },
);

it("keeps empty review drafts distinct from untouched reviews", async () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Edit review"));
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
  fireEvent.press(screen.getByLabelText("Update reading progress"));
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

it("keeps the saved progress summary separate from unsaved metric edits", () => {
  mockData.bookProgress = { currentPage: 10, totalPages: 100 };
  render(<BookInfo />);
  expect(screen.getByText("10% complete")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Update reading progress"));
  fireEvent.changeText(screen.getByLabelText("Pages read"), "25");
  expect(screen.getByLabelText("Percent complete").props.value).toBe("25");
  fireEvent.press(screen.getByLabelText("Update reading progress"));
  expect(screen.getByText("10% complete")).toBeTruthy();
  expect(screen.queryByText("25% complete")).toBeNull();
});

it("reconciles canonical reviews while keeping a collapsed unsaved review draft", () => {
  const { rerender } = render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Edit review"));
  fireEvent.changeText(screen.getByLabelText("Your review"), "Draft review");
  fireEvent.press(screen.getByLabelText("Edit review"));
  expect(screen.getByText("Draft review")).toBeTruthy();
  mockData = { ...mockData, owned: true };
  rerender(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Edit review"));
  expect(screen.getByLabelText("Your review").props.value).toBe("Draft review");
  mockData = { ...mockData, review: "Changed elsewhere" };
  rerender(<BookInfo />);
  expect(screen.getByLabelText("Your review").props.value).toBe("Changed elsewhere");
});

it("retains the review draft when an optimistic save rolls back", async () => {
  let rejectSave!: (error: Error) => void;
  mockUpdate.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const { rerender } = render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Edit review"));
  fireEvent.changeText(screen.getByLabelText("Your review"), "Keep this draft");
  fireEvent.press(screen.getByText("Save Review"));
  mockData = { ...mockData, review: "Keep this draft" };
  rerender(<BookInfo />);
  await act(async () => {
    mockData = { ...mockData, review: "Old review" };
    rejectSave(new Error("Review rejected"));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Review rejected");
  expect(screen.getByLabelText("Your review").props.value).toBe("Keep this draft");
});

it("blocks other screen writes immediately while a progress save is in flight", async () => {
  let finishSave!: (value: unknown) => void;
  mockUpdate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Update reading progress"));
  fireEvent.changeText(screen.getByLabelText("Percent complete"), "25");
  fireEvent.press(screen.getByText("Save progress"));
  fireEvent.press(screen.getByText("Own"));
  fireEvent.press(screen.getByText("Clear reading status"));
  fireEvent.press(screen.getByLabelText("Delete book tracking"));
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockDelete).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Pages read").props.editable).toBe(false);
  await act(async () => finishSave({ success: true }));
  expect(screen.getByText("Progress saved")).toBeTruthy();
});

it("restores all submitted progress inputs after an optimistic save rolls back", async () => {
  const logError = jest.spyOn(console, "error").mockImplementation(() => {});
  let rejectSave!: (error: Error) => void;
  mockUpdate.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const canonicalProgress = { currentPage: 10, totalPages: 100, percent: 10 };
  mockData.bookProgress = canonicalProgress;
  const { rerender } = render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Update reading progress"));
  fireEvent.changeText(screen.getByLabelText("Pages read"), "25");
  fireEvent.changeText(screen.getByLabelText("Chapters read"), "3");
  fireEvent.changeText(screen.getByLabelText("Percent complete"), "");
  fireEvent.press(screen.getByText("Save progress"));
  mockData = { ...mockData, bookProgress: { currentPage: 25, totalPages: 100, currentChapter: 3 } };
  rerender(<BookInfo />);
  await act(async () => {
    mockData = { ...mockData, bookProgress: canonicalProgress };
    rejectSave(new Error("Progress rejected"));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Failed to save progress.");
  expect(screen.getByLabelText("Pages read").props.value).toBe("25");
  expect(screen.getByLabelText("Chapters read").props.value).toBe("3");
  expect(screen.getByLabelText("Percent complete").props.value).toBe("");
  expect(screen.getByText("10% complete")).toBeTruthy();
  logError.mockRestore();
});

it("preserves exact chapter counts when the rounded percentage is 100", async () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Update reading progress"));
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

it("keeps manual percent and intentional emptiness until a metric edit restores automatic calculation", async () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Update reading progress"));
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

it("clears dates with API empty strings and clears status without deleting the record", async () => {
  render(<BookInfo />);
  fireEvent.press(screen.getByLabelText("Edit reading dates"));
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
  fireEvent.press(screen.getByLabelText("Edit review"));
  fireEvent.press(screen.getByLabelText("Delete book tracking"));
  fireEvent.press(screen.getByText("Delete"));
  await waitFor(() => expect(screen.getAllByText("Delete rejected").length).toBeGreaterThan(0));
  expect(screen.getByText("Remove from My Books?")).toBeTruthy();
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
  fireEvent.press(screen.getByLabelText("Update reading progress"));
  fireEvent.press(screen.getByLabelText("Edit review"));
  fireEvent.press(screen.getByLabelText("Delete book tracking"));
  fireEvent.press(screen.getByText("Delete"));
  mockDeleting = true;
  rerender(<BookInfo />);
  expect(screen.getByText("Remove from My Books?")).toBeTruthy();
  expect(screen.getByDisplayValue("Old review")).toBeTruthy();
  for (const label of ["Pages read", "Total pages", "Chapters read", "Total chapters"]) {
    expect(screen.getByLabelText(label)).toHaveProp("editable", false);
  }
  fireEvent.press(screen.getByText("Own"));
  fireEvent.press(screen.getByText("Save progress"));
  fireEvent.press(screen.getByText("Cancel"));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.getByText("Remove from My Books?")).toBeTruthy();
  finishDelete({ success: true });
  await waitFor(() => expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false));
});
