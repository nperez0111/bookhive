import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { PersonalBook, PersonalStorage } from "@/api/personalLibraryTypes";
import { useEbookUpload } from "../useEbookUpload";
import { authSession } from "@/context/auth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@/context/auth", () => ({
  authSession: jest.requireActual("../../../context/authSession").createAuthSessionScope(),
}));
const mockDelete = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: jest.fn().mockImplementation((uri: string) => ({ uri, exists: true, delete: mockDelete })),
}));

const pick = jest.mocked(DocumentPicker.getDocumentAsync);
const book: PersonalBook = {
  contentHash: "hash",
  title: "Ebook",
  format: "epub",
  mime: "application/epub+zip",
  sizeBytes: 50,
  createdAt: "2026-10-24",
  updatedAt: "2026-10-24",
};
const asset = {
  uri: "file:///cache/book.epub",
  name: "book.epub",
  size: 50,
  mimeType: "application/epub+zip",
  lastModified: 0,
};
const mutateAsync = jest.fn();
const unmatched = jest.fn();

function setup(storage: PersonalStorage | null = null) {
  return renderHook(() =>
    useEbookUpload({ storage, upload: { mutateAsync }, onUnmatched: unmatched }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  authSession.replace({ did: "did:plc:a", sid: "sid-a", handle: "a.test" });
  mutateAsync.mockResolvedValue({ book });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  pick.mockResolvedValue({ canceled: false, assets: [asset] });
});
afterEach(() => jest.restoreAllMocks());

it("explains a full library without opening the picker", async () => {
  const { result } = setup({ usedBytes: 100, quotaBytes: 100 });
  await act(async () => result.current.handleUpload());
  expect(Alert.alert).toHaveBeenCalledWith("Library full", expect.any(String));
  expect(pick).not.toHaveBeenCalled();
  expect(mutateAsync).not.toHaveBeenCalled();
});

it("rejects unsupported extensions and oversized files before sending bytes", async () => {
  const { result } = setup({ usedBytes: 80, quotaBytes: 100 });
  pick.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, name: "book.pdf" }] });
  await act(async () => result.current.handleUpload());
  expect(Alert.alert).toHaveBeenLastCalledWith("Unsupported file", expect.any(String));
  await act(async () => result.current.handleUpload());
  expect(Alert.alert).toHaveBeenLastCalledWith("Not enough space", expect.any(String));
  expect(mutateAsync).not.toHaveBeenCalled();
});

it("retains ZIP/uppercase format handling, progress, unmatched-book handoff and cleanup", async () => {
  pick.mockResolvedValue({ canceled: false, assets: [{ ...asset, name: "Book.FB2.ZIP" }] });
  const upload = deferred<{ book: PersonalBook }>();
  mutateAsync.mockReturnValueOnce(upload.promise);
  const { result } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleUpload();
  });
  await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  expect(result.current.uploadName).toBe("Book.FB2.ZIP");
  expect(result.current.uploadProgress).toBe(0);
  const [input] = mutateAsync.mock.calls[0];
  act(() => input.onProgress(0.5));
  expect(result.current.uploadProgress).toBe(0.5);
  act(() => input.onProgress(1));
  expect(result.current.isBusy).toBe(true);
  expect(mockDelete).not.toHaveBeenCalled();
  await act(async () => {
    upload.resolve({ book });
    await pending;
  });
  expect(unmatched).toHaveBeenCalledWith(book);
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(result.current.isBusy).toBe(false);
  expect(result.current.uploadName).toBeNull();
  expect(result.current.uploadProgress).toBeNull();
});

it("prevents duplicate pickers and recovers from picker rejection", async () => {
  const picker = deferred<DocumentPicker.DocumentPickerResult>();
  pick.mockReturnValueOnce(picker.promise);
  const { result } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleUpload();
  });
  await act(async () => {
    await result.current.handleUpload();
  });
  expect(pick).toHaveBeenCalledTimes(1);
  await act(async () => {
    picker.reject(new Error("Picker unavailable"));
    await pending;
  });
  expect(Alert.alert).toHaveBeenCalledWith("Upload failed", "Picker unavailable");
  expect(result.current.isBusy).toBe(false);
  pick.mockResolvedValueOnce({ canceled: true, assets: null });
  await act(async () => result.current.handleUpload());
  expect(mutateAsync).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.handleUpload();
  });
  expect(mutateAsync).toHaveBeenCalledTimes(1);
});

it("does not upload an old pick after logout and still removes its cache copy", async () => {
  const picker = deferred<DocumentPicker.DocumentPickerResult>();
  pick.mockReturnValueOnce(picker.promise);
  const { result } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleUpload();
  });
  authSession.replace(null);
  await act(async () => {
    picker.resolve({ canceled: false, assets: [asset] });
    await pending;
  });
  expect(mutateAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it.each(["unmount", "logout"])(
  "silences late upload completion after %s but cleans the copy",
  async (reason) => {
    const upload = deferred<{ book: PersonalBook }>();
    mutateAsync.mockReturnValueOnce(upload.promise);
    const { result, unmount } = setup();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleUpload();
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    if (reason === "unmount") unmount();
    else authSession.replace(null);
    await act(async () => {
      upload.resolve({ book });
      await pending;
    });
    expect(unmatched).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  },
);

it("shows authoritative upload errors and never deletes a non-cache original", async () => {
  pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ ...asset, uri: "file:///documents/book.epub" }],
  });
  mutateAsync.mockRejectedValueOnce(new Error("Server quota explanation"));
  const { result } = setup();
  await act(async () => {
    await result.current.handleUpload();
  });
  expect(Alert.alert).toHaveBeenCalledWith("Upload failed", "Server quota explanation");
  expect(mockDelete).not.toHaveBeenCalled();
  expect(result.current.isBusy).toBe(false);
});
