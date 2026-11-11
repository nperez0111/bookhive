import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { TrackedBookItem } from "../TrackedBookItem";
import { BOOK_STATUS } from "@/constants";
import type { UserBook } from "../../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

const mockUpdate = jest.fn();
let mockPending = false;
const book: UserBook = {
  hiveId: "bk_test",
  title: "A tracked book",
  authors: "A Writer",
  thumbnail: "",
  createdAt: "2026-10-24T00:00:00Z",
  userDid: "did:plc:reader",
  status: BOOK_STATUS.READING,
  bookProgress: { currentPage: 0, totalPages: 200, updatedAt: "2026-10-24T00:00:00Z" },
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.buzz" }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useUpdateBook: () => ({ mutateAsync: mockUpdate, isPending: mockPending }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = false;
  mockUpdate.mockResolvedValue({});
});

it("preserves zero-page progress in the compact row", () => {
  render(<TrackedBookItem book={book} grid={false} onError={jest.fn()} />);
  expect(screen.getByText("0 of 200 pages")).toBeTruthy();
});

it("refuses invalid identifiers before calling the mutation hook", async () => {
  const onError = jest.fn();
  render(<TrackedBookItem book={{ ...book, hiveId: "invalid" }} grid={false} onError={onError} />);
  fireEvent.press(screen.getByLabelText("Change reading status for A tracked book"));
  await act(async () => fireEvent.press(screen.getByText("Read")));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(
    "This book has an invalid identifier. Refresh your books and try again.",
  );
});

it("disables status writes while pending and has no overflow menu", () => {
  mockPending = true;
  render(<TrackedBookItem book={book} grid={false} onError={jest.fn()} />);
  const status = screen.getByLabelText("Change reading status for A tracked book");
  expect(status).toBeDisabled();
  fireEvent.press(status);
  expect(screen.queryByText("Reading status")).toBeNull();
  expect(screen.queryByLabelText("More options for A tracked book")).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("reports a failed status update to the collection instead of retaining row-local feedback", async () => {
  const onError = jest.fn();
  mockUpdate.mockRejectedValueOnce(new Error("Save failed"));
  render(<TrackedBookItem book={book} grid onError={onError} />);
  fireEvent.press(screen.getByLabelText("Change reading status for A tracked book"));
  await act(async () => fireEvent.press(screen.getByText("Read")));
  expect(mockUpdate).toHaveBeenCalledWith({
    hiveId: "bk_test",
    status: "buzz.bookhive.defs#finished",
  });
  expect(onError).toHaveBeenNthCalledWith(1, null);
  expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("Save failed"));
});
