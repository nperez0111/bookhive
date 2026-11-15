import { pressInFlight } from "../../test/pressInFlight";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import LibraryScreen from "../../app/library";
import { authSession } from "@/context/auth";
import type { PersonalBook, SyncDoc } from "@/api/personalLibraryTypes";

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const mockBook: PersonalBook = {
  contentHash: "file-content",
  title: "Uploaded ebook",
  filename: "ebook.epub",
  format: "epub",
  mime: "application/epub+zip",
  sizeBytes: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  progress: { percentage: "0.4", updatedAt: "2026-01-01" },
};
const mockDoc: SyncDoc = {
  document: "actual-filename-hash",
  title: "Reader document",
  filename: "ebook.epub",
  authors: null,
  percentage: 0.4,
  device: "Reader",
  updatedAt: "2026-01-01",
  hiveId: null,
  bookTitle: null,
  dismissed: false,
  hasFile: true,
};
let mockDocuments: SyncDoc[];
let mockLibraryError: Error | null;
const mockRefetch = jest.fn();
const mockMutations: Record<
  string,
  { mutateAsync: jest.Mock; mutate: jest.Mock; isPending: boolean; error: null }
> = {};
function mockMutationNames() {
  return [
    "AddToPersonalShelf",
    "CreatePersonalShelf",
    "DeletePersonalBook",
    "DeletePersonalShelf",
    "DeleteSyncDocument",
    "DismissSyncDocument",
    "LinkPersonalBook",
    "LinkSyncDocument",
    "RemoveFromPersonalShelf",
    "RenameSyncDocument",
    "UnlinkPersonalBook",
    "UpdatePersonalShelf",
    "UploadPersonalBook",
  ];
}
jest.mock("@/hooks/useBookhiveQuery", () => {
  const hooks: Record<string, unknown> = {};
  for (const name of mockMutationNames()) hooks[`use${name}`] = () => mockMutations[name];
  return {
    ...hooks,
    usePersonalLibrary: (filters: unknown) => ({
      data: { pages: [{ books: [mockBook], total: 1 }] },
      isLoading: false,
      error: filters ? mockLibraryError : null,
      refetch: mockRefetch,
    }),
    usePersonalShelves: () => ({
      data: [{ id: 1, name: "Private shelf", bookCount: 0 }],
      refetch: mockRefetch,
    }),
    useSyncDocuments: () => ({
      data: mockDocuments,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }),
    storageFromLibrary: () => null,
  };
});
jest.mock("@/context/auth", () => ({
  authSession: jest.requireActual("../../context/authSession").createAuthSessionScope(),
  getBaseUrl: () => "https://bookhive.buzz",
}));
jest.mock("@/components/ebooks/useEbookUpload", () => ({
  useEbookUpload: () => ({ handleUpload: jest.fn(), isBusy: false }),
}));
jest.mock("@/components/AnimatedListItem", () => ({
  AnimatedListItem: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/PersonalBookCard", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    PersonalBookCard: ({ onPress }: { onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>Open uploaded ebook</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/components/BookSearchModal", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    BookSearchModal: ({
      visible,
      onSelectBook,
      onClose,
    }: {
      visible: boolean;
      onSelectBook: (book: unknown) => void;
      onClose: () => void;
    }) =>
      visible ? (
        <>
          <Pressable onPress={() => onSelectBook({ id: "bk_chosen", title: "Catalogue book" })}>
            <Text>Choose catalogue book</Text>
          </Pressable>
          <Pressable onPress={onClose}>
            <Text>Cancel matching</Text>
          </Pressable>
        </>
      ) : null,
  };
});
jest.mock("@/components/QueryErrorHandler", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    QueryErrorHandler: ({ error, onRetry }: { error: Error; onRetry: () => void }) => (
      <Pressable onPress={onRetry}>
        <Text>{error.message}</Text>
        <Text>Retry library</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/components/BackNavigationHeader", () => ({
  BackNavigationHeader: ({ rightElement }: { rightElement: React.ReactNode }) => rightElement,
}));
jest.mock("@/components/InfinitePaginationFooter", () => ({
  InfinitePaginationFooter: () => null,
}));
jest.mock("@/components/ProgressBar", () => ({ ProgressBar: () => null }));
jest.mock("@/utils/sharePersonalBook", () => ({ sharePersonalBook: jest.fn() }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/hooks/useScreenTopInset", () => ({ useScreenTopInset: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#fff" }));
jest.mock("expo-router", () => ({
  useRouter: () => jest.requireMock("expo-router").router,
  router: { push: jest.fn() },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light" },
}));

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of mockMutationNames())
    mockMutations[name] = {
      mutateAsync: jest.fn().mockResolvedValue({}),
      mutate: jest.fn(),
      isPending: false,
      error: null,
    };
  mockDocuments = [mockDoc];
  mockLibraryError = null;
  mockRefetch.mockResolvedValue({});
  authSession.replace({ did: "did:plc:a", sid: "a", handle: "a.test" });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function chooseMatch() {
  await pressInFlight(screen.getByText("Open uploaded ebook"));
  await pressInFlight(screen.getByText("Link to a BookHive book"));
  await pressInFlight(screen.getByText("Choose catalogue book"));
}

it("keeps cached cards visible and offers retry when a filtered query fails", async () => {
  mockLibraryError = new Error("Filtered library unavailable");
  await render(<LibraryScreen />);
  expect(screen.getByText("Filtered library unavailable")).toBeTruthy();
  expect(screen.getByText("Open uploaded ebook")).toBeTruthy();
  await pressInFlight(screen.getByText("Retry library"));
  expect(mockRefetch).toHaveBeenCalled();
});

it.each([0, 2])("never guesses document identity with %s returned documents", async (count) => {
  mockDocuments = Array.from({ length: count }, (_, i) => ({
    ...mockDoc,
    document: `actual-${i}`,
  }));
  await render(<LibraryScreen />);
  await chooseMatch();
  expect(mockMutations.LinkPersonalBook.mutateAsync).not.toHaveBeenCalled();
  expect(mockMutations.LinkSyncDocument.mutateAsync).not.toHaveBeenCalled();
  if (count) {
    await pressInFlight(
      screen.getByLabelText("Use progress from Reader document, document actual-0"),
    );
    await waitFor(() =>
      expect(mockMutations.LinkSyncDocument.mutateAsync).toHaveBeenCalledWith({
        document: "actual-0",
        hiveId: "bk_chosen",
      }),
    );
  } else {
    expect(screen.getByText(/No synced documents are available/)).toBeTruthy();
    await pressInFlight(screen.getByText("Link file only — don't move progress"));
    await waitFor(() =>
      expect(mockMutations.LinkPersonalBook.mutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mockMutations.LinkSyncDocument.mutateAsync).not.toHaveBeenCalled();
  }
});

it("preserves file-link partial success and retries only the chosen document's progress", async () => {
  mockMutations.LinkSyncDocument.mutateAsync.mockRejectedValueOnce(new Error("Offline"));
  await render(<LibraryScreen />);
  await chooseMatch();
  const label = "Use progress from Reader document, document actual-filename-hash";
  await pressInFlight(screen.getByLabelText(label));
  await waitFor(() =>
    expect(screen.getByText(/The file is linked. Moving progress failed/)).toBeTruthy(),
  );
  await pressInFlight(screen.getByLabelText(label));
  await waitFor(() => expect(mockMutations.LinkSyncDocument.mutateAsync).toHaveBeenCalledTimes(2));
  expect(mockMutations.LinkPersonalBook.mutateAsync).toHaveBeenCalledTimes(1);
});

it.each(["unmount", "session change"])(
  "continues selected multi-step linking after %s only while its session remains current",
  async (reason) => {
    const first = deferred();
    mockMutations.LinkPersonalBook.mutateAsync.mockReturnValueOnce(first.promise);
    const view = await render(<LibraryScreen />);
    await chooseMatch();
    await pressInFlight(
      screen.getByLabelText("Use progress from Reader document, document actual-filename-hash"),
    );
    if (reason === "unmount") await view.unmount();
    else authSession.replace(null);
    await act(async () => {
      first.resolve({});
    });
    expect(mockMutations.LinkSyncDocument.mutateAsync).toHaveBeenCalledTimes(
      reason === "unmount" ? 1 : 0,
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  },
);

it("does not close a newer matching draft when an older operation completes", async () => {
  const first = deferred();
  mockMutations.LinkPersonalBook.mutateAsync.mockReturnValueOnce(first.promise);
  await render(<LibraryScreen />);
  await chooseMatch();
  await pressInFlight(
    screen.getByLabelText("Use progress from Reader document, document actual-filename-hash"),
  );
  await pressInFlight(screen.getByText("Cancel"));
  await pressInFlight(screen.getByText("Open uploaded ebook"));
  await pressInFlight(screen.getByText("Link to a BookHive book"));
  await act(async () => {
    first.resolve({});
  });
  expect(screen.getByText("Choose catalogue book")).toBeTruthy();
});

it("awaits create-then-add after navigation instead of depending on observer callbacks", async () => {
  const first = deferred<{ shelf: { id: number; name: string } }>();
  mockMutations.CreatePersonalShelf.mutateAsync.mockReturnValueOnce(first.promise);
  const view = await render(<LibraryScreen />);
  await pressInFlight(screen.getByText("Open uploaded ebook"));
  await pressInFlight(screen.getByText("Shelves"));
  await pressInFlight(screen.getByText("New shelf…"));
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Sci-fi"), "New private shelf");
  await pressInFlight(screen.getByText("Create shelf"));
  await view.unmount();
  await act(async () => {
    first.resolve({ shelf: { id: 9, name: "New private shelf" } });
  });
  expect(mockMutations.AddToPersonalShelf.mutateAsync).toHaveBeenCalledWith({
    shelfId: 9,
    contentHash: "file-content",
  });
});

it("keeps a newer prompt open after an older create completes", async () => {
  const first = deferred<{ shelf: { id: number; name: string } }>();
  mockMutations.CreatePersonalShelf.mutateAsync.mockReturnValueOnce(first.promise);
  await render(<LibraryScreen />);
  await pressInFlight(screen.getByText("Shelf"));
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Sci-fi"), "A");
  await pressInFlight(screen.getByText("Create shelf"));
  await pressInFlight(screen.getByText("Cancel"));
  await pressInFlight(screen.getByText("Shelf"));
  await act(async () => {
    first.resolve({ shelf: { id: 9, name: "A" } });
  });
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Sci-fi"), "B");
  expect(screen.getByDisplayValue("B")).toBeTruthy();
});

it("prevents duplicate create submissions before pending state rerenders", async () => {
  const first = deferred<{ shelf: { id: number; name: string } }>();
  mockMutations.CreatePersonalShelf.mutateAsync.mockReturnValueOnce(first.promise);
  await render(<LibraryScreen />);
  await pressInFlight(screen.getByText("Shelf"));
  const input = screen.getByPlaceholderText("e.g. Sci-fi");
  await fireEvent.changeText(input, "Only one");
  const submit = screen.getByText("Create shelf");
  await act(() => {
    void fireEvent.press(submit);
    void fireEvent(input, "submitEditing");
  });
  expect(mockMutations.CreatePersonalShelf.mutateAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve({ shelf: { id: 9, name: "Only one" } });
  });
});

it.each(["session change", "add failure"])(
  "preserves the created shelf after %s without repeating create",
  async (reason) => {
    const first = deferred<{ shelf: { id: number; name: string } }>();
    mockMutations.CreatePersonalShelf.mutateAsync.mockReturnValueOnce(first.promise);
    mockMutations.AddToPersonalShelf.mutateAsync.mockRejectedValueOnce(new Error("Offline"));
    await render(<LibraryScreen />);
    await pressInFlight(screen.getByText("Open uploaded ebook"));
    await pressInFlight(screen.getByText("Shelves"));
    await pressInFlight(screen.getByText("New shelf…"));
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. Sci-fi"), "Retained shelf");
    await pressInFlight(screen.getByText("Create shelf"));
    if (reason === "session change") authSession.replace(null);
    await act(async () => {
      first.resolve({ shelf: { id: 9, name: "Retained shelf" } });
    });
    expect(mockMutations.CreatePersonalShelf.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutations.AddToPersonalShelf.mutateAsync).toHaveBeenCalledTimes(
      reason === "add failure" ? 1 : 0,
    );
    if (reason === "add failure") {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Couldn't save",
        expect.stringContaining("was created, but the ebook wasn't added"),
      );
      expect(screen.queryByText("Create shelf")).toBeNull();
    } else expect(Alert.alert).not.toHaveBeenCalled();
  },
);
