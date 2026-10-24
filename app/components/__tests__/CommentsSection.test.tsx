/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { CommentsSection, type CommentItem } from "../CommentsSection";
import { StarDisplay } from "../StarDisplay";
import { Ionicons } from "@expo/vector-icons";

const mockUpdateBook = jest.fn();
const mockUpdateComment = jest.fn();
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useUpdateBook: () => ({ mutateAsync: mockUpdateBook, isPending: false }),
  useUpdateComment: () => ({ mutateAsync: mockUpdateComment, isPending: false }),
}));
jest.mock("@/context/auth", () => ({
  getBaseUrl: () => "https://bookhive.buzz",
  useAuth: () => ({ authState: { did: "did:plc:reader" } }),
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#123456" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));

const review: CommentItem = {
  id: "review",
  did: "did:plc:reader",
  handle: "reader.test",
  review: "Original review",
  createdAt: "2026-01-01T00:00:00.000Z",
  stars: 7,
};

beforeEach(() => {
  jest.clearAllMocks();
});

it("uses the shared half-star presentation with the original ten-point rating", () => {
  render(<CommentsSection hiveId="bk_test" comments={[review]} />);
  expect(screen.UNSAFE_getByType(StarDisplay).props.rating).toBe(7);
  expect(
    screen.UNSAFE_getAllByType(Ionicons).filter((icon) => icon.props.name === "star-half-sharp"),
  ).toHaveLength(1);
});

it("edits a review through book updates even without a comment parent", async () => {
  mockUpdateBook.mockResolvedValue({ success: true });
  render(<CommentsSection hiveId="bk_test" comments={[review]} />);
  fireEvent.press(screen.getByText("Edit"));
  fireEvent.changeText(screen.getByLabelText("Edit your review"), "New review");
  fireEvent.press(screen.getByText("Save"));
  await waitFor(() =>
    expect(mockUpdateBook).toHaveBeenCalledWith({ hiveId: "bk_test", review: "New review" }),
  );
  expect(mockUpdateComment).not.toHaveBeenCalled();
});

it("permits clearing a review", async () => {
  mockUpdateBook.mockResolvedValue({ success: true });
  render(<CommentsSection hiveId="bk_test" comments={[review]} />);
  fireEvent.press(screen.getByText("Edit"));
  fireEvent.changeText(screen.getByLabelText("Edit your review"), "");
  fireEvent.press(screen.getByText("Save"));
  await waitFor(() =>
    expect(mockUpdateBook).toHaveBeenCalledWith({ hiveId: "bk_test", review: "" }),
  );
});

it("keeps a failed review draft visible and reports the error", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockUpdateBook.mockRejectedValue(new Error("Offline"));
  render(<CommentsSection hiveId="bk_test" comments={[review]} />);
  fireEvent.press(screen.getByText("Edit"));
  fireEvent.changeText(screen.getByLabelText("Edit your review"), "Keep this draft");
  fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("Error", "Failed to save review"));
  expect(screen.getByDisplayValue("Keep this draft")).toBeTruthy();
  alert.mockRestore();
});
