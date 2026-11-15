import { pressInFlight } from "../../test/pressInFlight";
/// <reference types="jest" />
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { CommentsSection, type CommentItem } from "../CommentsSection";
import { authSession } from "@/context/auth";

const mockUpdateBook = jest.fn();
const mockUpdateComment = jest.fn();
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useUpdateBook: () => ({ mutateAsync: mockUpdateBook, isPending: false }),
  useUpdateComment: () => ({ mutateAsync: mockUpdateComment, isPending: false }),
}));
jest.mock("@/context/auth", () => ({
  authSession: jest.requireActual("../../context/authSession").createAuthSessionScope(),
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
  mockUpdateBook.mockReset().mockResolvedValue({ success: true });
  mockUpdateComment.mockReset().mockResolvedValue({ success: true });
  authSession.replace({ did: "did:plc:reader", sid: "sid", handle: "reader.test" });
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it.each(["unmount", "session change"])(
  "silences an obsolete reply failure after %s",
  async (reason) => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const pending = deferred();
    mockUpdateComment.mockReturnValueOnce(pending.promise);
    const view = await render(
      <CommentsSection
        hiveId="bk_test"
        comments={[{ ...review, uri: "at://review", cid: "cid" }]}
      />,
    );
    await pressInFlight(screen.getByText("Reply"));
    await fireEvent.changeText(screen.getByPlaceholderText("Write a reply..."), "Old reply");
    await pressInFlight(screen.getAllByText("Reply").at(-1)!);
    if (reason === "unmount") await view.unmount();
    else authSession.replace(null);
    await act(async () => {
      pending.reject(new Error("Obsolete failure"));
    });
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  },
);

it("blocks same-render duplicate replies, cancellation, reopening and draft edits while writing", async () => {
  const pending = deferred();
  mockUpdateComment.mockReturnValueOnce(pending.promise);
  await render(
    <CommentsSection hiveId="bk_test" comments={[{ ...review, uri: "at://review", cid: "cid" }]} />,
  );
  await pressInFlight(screen.getByText("Reply"));
  await fireEvent.changeText(screen.getByPlaceholderText("Write a reply..."), "First reply");
  const submit = screen.getAllByText("Reply").at(-1)!;
  await pressInFlight(submit, submit);
  await pressInFlight(screen.getByText("Cancel"));
  await pressInFlight(screen.getAllByText("Reply")[0]);
  await fireEvent.changeText(screen.getByPlaceholderText("Write a reply..."), "Replacement draft");
  expect(screen.getByDisplayValue("First reply")).toBeTruthy();
  expect(mockUpdateComment).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve({ success: true });
  });
  expect(screen.queryByPlaceholderText("Write a reply...")).toBeNull();
});

it.each(["edit", "reply"])(
  "retains an open %s on its stable record identity after insertion and reorder",
  async (mode) => {
    const first = { ...review, id: "at://review-a", uri: "at://review-a", cid: "cid-a" };
    const second = {
      ...review,
      id: "at://review-b",
      uri: "at://review-b",
      cid: "cid-b",
      review: "Other review",
    };
    const view = await render(<CommentsSection hiveId="bk_test" comments={[first]} />);
    await pressInFlight(screen.getByText(mode === "edit" ? "Edit" : "Reply"));
    const input =
      mode === "edit"
        ? screen.getByLabelText("Edit your review")
        : screen.getByPlaceholderText("Write a reply...");
    await fireEvent.changeText(input, "Keep with record A");
    await view.rerender(<CommentsSection hiveId="bk_test" comments={[second, first]} />);
    expect(screen.getByDisplayValue("Keep with record A")).toBeTruthy();
    if (mode === "reply") {
      await act(async () => {
        await pressInFlight(screen.getAllByText("Reply").at(-1)!);
      });
      expect(mockUpdateComment).toHaveBeenCalledWith(
        expect.objectContaining({ parentUri: "at://review-a", comment: "Keep with record A" }),
      );
    }
  },
);

it("blocks same-render duplicate review saves", async () => {
  const pending = deferred();
  mockUpdateBook.mockReturnValueOnce(pending.promise);
  await render(<CommentsSection hiveId="bk_test" comments={[review]} />);
  await pressInFlight(screen.getByText("Edit"));
  await fireEvent.changeText(screen.getByLabelText("Edit your review"), "One write");
  const save = screen.getByText("Save");
  await pressInFlight(save, save);
  expect(mockUpdateBook).toHaveBeenCalledTimes(1);
  expect(mockUpdateBook).toHaveBeenCalledWith({ hiveId: "bk_test", review: "One write" });
  expect(mockUpdateComment).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve({ success: true });
  });
});

it("permits clearing a review", async () => {
  mockUpdateBook.mockResolvedValue({ success: true });
  await render(<CommentsSection hiveId="bk_test" comments={[review]} />);
  await pressInFlight(screen.getByText("Edit"));
  await fireEvent.changeText(screen.getByLabelText("Edit your review"), "");
  await pressInFlight(screen.getByText("Save"));
  await waitFor(() =>
    expect(mockUpdateBook).toHaveBeenCalledWith({ hiveId: "bk_test", review: "" }),
  );
});

it("keeps a failed review draft visible and reports the error", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockUpdateBook.mockRejectedValue(new Error("Offline"));
  await render(<CommentsSection hiveId="bk_test" comments={[review]} />);
  await pressInFlight(screen.getByText("Edit"));
  await fireEvent.changeText(screen.getByLabelText("Edit your review"), "Keep this draft");
  await pressInFlight(screen.getByText("Save"));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("Error", "Failed to save review"));
  expect(screen.getByDisplayValue("Keep this draft")).toBeTruthy();
  alert.mockRestore();
});
