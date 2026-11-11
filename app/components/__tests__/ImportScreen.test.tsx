import { act, fireEvent, render, screen } from "@testing-library/react-native";
import ImportScreen from "@/app/import";
import { createAuthSessionScope } from "@/context/authSession";

const mockSession = createAuthSessionScope();
const mockPick = jest.fn();
const mockImport = jest.fn();
const mockDelete = jest.fn();
const mockReset = jest.fn();
jest.mock("@/context/auth", () => ({
  get authSession() {
    return mockSession;
  },
}));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => mockPick(...args),
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    exists = true;
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    delete() {
      mockDelete(this.uri);
    }
  },
}));
jest.mock("@/hooks/useCsvImport", () => ({
  useCsvImport: () => ({
    mutateAsync: mockImport,
    reset: mockReset,
    uploadProgress: 0,
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
}));
jest.mock("@/components/BackNavigationHeader", () => ({ BackNavigationHeader: () => null }));
jest.mock("@/components/ProgressBar", () => ({ ProgressBar: () => null }));
jest.mock("@/hooks/useScreenTopInset", () => ({ useScreenTopInset: () => 0 }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const asset = (uri = "file:///cache/DocumentPicker/one.csv", name = "books.csv", size = 10) => ({
  uri,
  name,
  size,
  lastModified: 0,
});
async function pick(file = asset()) {
  mockPick.mockResolvedValueOnce({ canceled: false, assets: [file] });
  fireEvent.press(screen.getByText(/Choose.*CSV/));
  await act(async () => {});
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPick.mockReset();
  mockImport.mockReset();
  mockSession.replace({ did: "did:plc:a", handle: "a.test", sid: "sid-a" });
  mockImport.mockResolvedValue({});
});

it("guards picker and import before pending state rerenders, retaining the copy until settlement", async () => {
  const picker = deferred<{ canceled: false; assets: ReturnType<typeof asset>[] }>();
  mockPick.mockReturnValueOnce(picker.promise);
  const request = deferred<unknown>();
  mockImport.mockReturnValueOnce(request.promise);
  const view = render(<ImportScreen />);
  const pickerButton = screen.getByRole("button", { name: "Choose CSV file" });
  act(() => {
    fireEvent.press(pickerButton);
    fireEvent.press(pickerButton);
  });
  expect(mockPick).toHaveBeenCalledTimes(1);
  await act(async () => picker.resolve({ canceled: false, assets: [asset()] }));
  const importButton = screen.getByText("Import books");
  act(() => {
    fireEvent.press(importButton);
    fireEvent.press(importButton);
    fireEvent.press(screen.getByText("Hardcover"));
  });
  expect(mockImport).toHaveBeenCalledTimes(1);
  expect(mockDelete).not.toHaveBeenCalled();
  view.unmount();
  expect(mockDelete).not.toHaveBeenCalled();
  await act(async () => request.resolve({}));
  expect(mockDelete).toHaveBeenCalledWith(asset().uri);
  expect(mockDelete).toHaveBeenCalledTimes(1);
});

it.each(["unmount", "session"])(
  "cleans late picker results without publishing stale selection (%s)",
  async (reason) => {
    const picker = deferred<unknown>();
    mockPick.mockReturnValueOnce(picker.promise);
    const view = render(<ImportScreen />);
    fireEvent.press(screen.getByText("Choose CSV file"));
    if (reason === "unmount") view.unmount();
    else act(() => mockSession.replace(null));
    await act(async () => picker.resolve({ canceled: false, assets: [asset()] }));
    expect(mockDelete).toHaveBeenCalledWith(asset().uri);
    expect(mockImport).not.toHaveBeenCalled();
  },
);

it("cleans replaced selections, provider changes and unused selections on unmount", async () => {
  const view = render(<ImportScreen />);
  await pick();
  await pick(asset("file:///cache/DocumentPicker/two.csv"));
  expect(mockDelete).toHaveBeenCalledWith(asset().uri);
  fireEvent.press(screen.getByText("Hardcover"));
  expect(mockDelete).toHaveBeenCalledWith("file:///cache/DocumentPicker/two.csv");
  await pick(asset("file:///cache/DocumentPicker/three.csv"));
  view.unmount();
  expect(mockDelete).toHaveBeenCalledWith("file:///cache/DocumentPicker/three.csv");
});

it.each([asset(undefined, "archive.zip"), asset(undefined, "large.csv", 51 * 1024 * 1024)])(
  "cleans rejected picker copies: $name",
  async (file) => {
    render(<ImportScreen />);
    await pick(file);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(mockDelete).toHaveBeenCalledWith(file.uri);
  },
);

it.each([
  "file:///documents/original.csv",
  "content://provider/original.csv",
  "file:///cache/DocumentPicker/../original.csv",
])("never deletes an unowned picker URI: %s", async (uri) => {
  const view = render(<ImportScreen />);
  await pick(asset(uri));
  view.unmount();
  expect(mockDelete).not.toHaveBeenCalled();
});

it("cleans the copy after failed import and requires a fresh file for retry", async () => {
  mockImport.mockRejectedValueOnce(new Error("network lost"));
  render(<ImportScreen />);
  await pick();
  fireEvent.press(screen.getByText("Import books"));
  await act(async () => {});
  expect(mockDelete).toHaveBeenCalledWith(asset().uri);
  expect(screen.queryByText("Import books")).toBeNull();
});
