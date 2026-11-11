import { act, renderHook, waitFor } from "@testing-library/react-native";
import { notifyManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { deferred, queryWrapper } from "../../test/queryHelpers";
import { authSession } from "@/context/auth";
import {
  useDeletePersonalBook,
  useDeleteSyncDocument,
  useDismissSyncDocument,
  useUploadPersonalBook,
  useLinkPersonalBook,
  useLinkSyncDocument,
} from "../useBookhiveQuery";
import { bookMutationQueue } from "@/utils/bookMutations";

const mockSent = jest.fn();
jest.mock("@/utils/catalogueLists", () => ({}));
jest.mock("@/context/auth", () => {
  const { createAuthSessionScope } = jest.requireActual("../../context/authSession");
  const scope = createAuthSessionScope();
  return {
    authSession: scope,
    getBaseUrl: () => "https://bookhive.buzz",
    getAuthState: () => scope.state,
    createSessionFetch: () => {
      const session = scope.capture();
      return async (...args: unknown[]) => {
        session.assertCurrent();
        const result = await mockSent(session.state, ...args);
        session.assertCurrent();
        return result;
      };
    },
    authFetch: jest.fn(),
  };
});

let client: QueryClient;
const xhrDescriptor = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
const Wrapper = queryWrapper(() => client);
beforeEach(() => {
  notifyManager.setNotifyFunction((callback) => act(callback));
  mockSent.mockReset().mockResolvedValue({});
  authSession.replace({ did: "did:plc:a", handle: "a.test", sid: "session-a" });
  client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false, gcTime: Infinity },
      queries: { gcTime: Infinity },
    },
  });
});
afterEach(() => {
  client.clear();
  notifyManager.setNotifyFunction((callback) => callback());
  jest.restoreAllMocks();
  if (xhrDescriptor) Object.defineProperty(globalThis, "XMLHttpRequest", xhrDescriptor);
  else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
});

it.each([
  ["delete file", useDeletePersonalBook, { contentHash: "hash" }, "personalLibrary"],
  ["delete document", useDeleteSyncDocument, { document: "doc" }, "syncDocuments"],
  [
    "dismiss document",
    useDismissSyncDocument,
    { document: "doc", dismissed: true },
    "syncDocuments",
  ],
] as const)(
  "does not let delayed %s mutate account B or roll A data into B",
  async (_name, hook, input, key) => {
    const gate = deferred();
    const cancellation = jest.spyOn(client, "cancelQueries").mockReturnValue(gate.promise);
    const { result } = renderHook(() => hook(), { wrapper: Wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync(input as never).catch((error: Error) => error);
    });
    await waitFor(() => expect(cancellation).toHaveBeenCalled());
    const bData =
      key === "personalLibrary"
        ? { pages: [{ books: [{ contentHash: "b" }], total: 1 }] }
        : [{ document: "b" }];
    await act(async () => {
      authSession.replace({ did: "did:plc:b", handle: "b.test", sid: "session-b" });
      client.clear();
      client.setQueryData([key], bData);
    });
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(mockSent).not.toHaveBeenCalled();
    expect(client.getQueryData([key])).toEqual(bData);
  },
);

it("captures upload identity before mutation scheduling rather than at XHR send", async () => {
  const { result } = renderHook(() => useUploadPersonalBook(), { wrapper: Wrapper });
  authSession.replace({ did: "did:plc:b", handle: "b.test", sid: "session-b" });
  await act(async () => {
    await expect(
      result.current.mutateAsync({ uri: "file:///book.epub", name: "book.epub" }),
    ).rejects.toThrow("session changed");
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
});

it("deleting a file preserves counts in unrelated filtered ebook caches", async () => {
  const allKey = ["personalLibrary", null, "", "newest"];
  const shelfKey = ["personalLibrary", 12, "", "newest"];
  client.setQueryData(allKey, {
    pages: [{ books: [{ contentHash: "hash" }], total: 1 }],
    pageParams: [""],
  });
  const unrelated = { pages: [{ books: [{ contentHash: "other" }], total: 4 }], pageParams: [""] };
  client.setQueryData(shelfKey, unrelated);
  const { result } = renderHook(() => useDeletePersonalBook(), { wrapper: Wrapper });
  await act(async () => {
    await result.current.mutateAsync({ contentHash: "hash" });
  });
  expect(client.getQueryData<any>(allKey).pages[0]).toEqual({ books: [], total: 0 });
  expect(client.getQueryData(shelfKey)).toEqual(unrelated);
});

it("aborts an in-flight XHR upload when the captured session changes", async () => {
  const xhr = {
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    upload: {},
    send: jest.fn(),
    abort: jest.fn(),
  };
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: jest.fn(() => xhr),
  });
  const { result } = renderHook(() => useUploadPersonalBook(), { wrapper: Wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current
      .mutateAsync({ uri: "file:///book.epub", name: "book.epub" })
      .catch((error: Error) => error);
  });
  await waitFor(() => expect(xhr.send).toHaveBeenCalled());
  expect(xhr.setRequestHeader).toHaveBeenCalledWith("cookie", "sid=session-a");
  await act(async () => {
    authSession.replace(null);
    await pending;
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(xhr.abort).toHaveBeenCalled();
  await expect(pending).resolves.toEqual(
    expect.objectContaining({ message: expect.stringContaining("session changed") }),
  );
});

it.each([
  {
    contentHash: "hash",
    title: "Book",
    format: "epub",
    mime: "application/epub+zip",
    sizeBytes: 42,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  {},
])(
  "reconciles library caches after a 2xx upload, even when its body is malformed: %p",
  async (book) => {
    const xhr = {
      open: jest.fn(),
      setRequestHeader: jest.fn(),
      upload: {},
      send: jest.fn(),
      status: 200,
      responseText: JSON.stringify({ book }),
      onload: undefined as undefined | (() => void),
      onloadend: undefined as undefined | (() => void),
    };
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      value: jest.fn(() => xhr),
    });
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUploadPersonalBook(), { wrapper: Wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync({ uri: "file:///book.epub", name: "book.epub" })
        .catch((error: Error) => error);
    });
    await waitFor(() => expect(xhr.send).toHaveBeenCalled());
    await act(async () => {
      xhr.onload!();
      xhr.onloadend!();
      await pending;
    });
    expect(invalidate.mock.calls).toEqual(
      ("contentHash" in book
        ? ["personalLibrary", "personalShelves", "syncDocuments", "profile"]
        : ["personalLibrary"]
      ).map((key) => [{ queryKey: [key] }]),
    );
    await expect(pending).resolves.toEqual(
      "contentHash" in book
        ? { book }
        : expect.objectContaining({ message: expect.stringContaining("invalid upload response") }),
    );
  },
);

it("rolls back only the failed file and defers offline refetch until both deletes settle", async () => {
  const key = ["personalLibrary", null, "", "recent"];
  client.setQueryData(key, {
    pages: [{ books: [{ contentHash: "a" }, { contentHash: "b" }], total: 2 }],
    pageParams: [""],
  });
  const offline = jest.fn().mockRejectedValue(new Error("Offline"));
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: offline,
    staleTime: Infinity,
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const a = deferred<unknown>();
  const b = deferred<unknown>();
  mockSent.mockImplementation((_session, _url, options) =>
    options.body.contentHash === "a" ? a.promise : b.promise,
  );
  const { result } = renderHook(() => useDeletePersonalBook(), { wrapper: Wrapper });
  let failed!: Promise<unknown>;
  let saved!: Promise<unknown>;
  act(() => {
    failed = result.current.mutateAsync({ contentHash: "a" }).catch((error: Error) => error);
    saved = result.current.mutateAsync({ contentHash: "b" });
  });
  await waitFor(() => expect(mockSent).toHaveBeenCalledTimes(2));
  await act(async () => {
    a.reject(new Error("Delete failed"));
    await failed;
  });
  expect(offline).not.toHaveBeenCalled();
  await act(async () => {
    b.resolve({});
    await saved;
  });
  await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
  expect(offline).toHaveBeenCalledTimes(1);
  expect(client.getQueryData<any>(key).pages[0]).toEqual({
    books: [{ contentHash: "a" }],
    total: 1,
  });
  unsubscribe();
});

it("a failed document deletion preserves another document's successful dismissal while offline", async () => {
  const key = ["syncDocuments"];
  client.setQueryData(key, [
    { document: "a", dismissed: false },
    { document: "b", dismissed: false },
  ]);
  const offline = jest.fn().mockRejectedValue(new Error("Offline"));
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: offline,
    staleTime: Infinity,
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const a = deferred<unknown>();
  const b = deferred<unknown>();
  mockSent.mockImplementation((_session, _url, options) =>
    options.body.document === "a" ? a.promise : b.promise,
  );
  const { result } = renderHook(
    () => ({ remove: useDeleteSyncDocument(), dismiss: useDismissSyncDocument() }),
    { wrapper: Wrapper },
  );
  let failed!: Promise<unknown>;
  let saved!: Promise<unknown>;
  act(() => {
    failed = result.current.remove.mutateAsync({ document: "a" }).catch((error: Error) => error);
    saved = result.current.dismiss.mutateAsync({ document: "b", dismissed: true });
  });
  await waitFor(() => expect(mockSent).toHaveBeenCalledTimes(2));
  await act(async () => {
    b.resolve({});
    await saved;
  });
  expect(offline).not.toHaveBeenCalled();
  await act(async () => {
    a.reject(new Error("Delete failed"));
    await failed;
  });
  await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
  expect(client.getQueryData(key)).toEqual([
    { document: "a", dismissed: false },
    { document: "b", dismissed: true },
  ]);
  unsubscribe();
});

it.each([useLinkPersonalBook, useLinkSyncDocument])(
  "link completion cannot refetch over a pending tracked-book edit",
  async (hook) => {
    const id = "bk_target" as import("../../../src/types").HiveId;
    client.setQueryData(["getBook", id], { book: { id }, stars: 2 });
    const refetch = jest.fn().mockResolvedValue({ book: { id }, stars: 8, owned: true });
    const observer = new QueryObserver(client, {
      queryKey: ["getBook", id],
      queryFn: refetch,
      staleTime: Infinity,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    const response = deferred<unknown>();
    const scope = authSession.capture();
    const queue = bookMutationQueue(client, () => !scope.signal.aborted);
    const edit = queue.update(
      { hiveId: id, stars: 8 },
      jest.fn().mockReturnValue(response.promise),
    );
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => hook(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        contentHash: "hash",
        document: "doc",
        hiveId: id,
      } as never);
    });
    expect(invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "getBook")).toBe(
      false,
    );
    expect(client.getQueryData<any>(["getBook", id]).stars).toBe(8);
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => {
      response.resolve({
        success: true,
        userBook: {
          hiveId: id,
          uri: "at://a/book/one",
          cid: "cid",
          title: "Book",
          authors: "Author",
          owned: true,
          stars: 8,
          status: null,
          review: null,
          startedAt: null,
          finishedAt: null,
          bookProgress: null,
          previousReads: null,
          createdAt: "now",
          indexedAt: "now",
        },
      });
      await edit;
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["getBook"] });
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    unsubscribe();
  },
);

it.each([useLinkPersonalBook, useLinkSyncDocument])(
  "late linking cannot invalidate the replacement viewer's caches",
  async (hook) => {
    const response = deferred<unknown>();
    mockSent.mockReturnValue(response.promise);
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => hook(), { wrapper: Wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync({ contentHash: "hash", document: "doc", hiveId: "bk_target" } as never)
        .catch((error: Error) => error);
    });
    await waitFor(() => expect(mockSent).toHaveBeenCalledTimes(1));
    authSession.replace({ did: "did:plc:b", handle: "b.test", sid: "session-b" });
    client.clear();
    const bData = { owned: false };
    client.setQueryData(["getBook", "bk_target"], bData);
    await act(async () => {
      response.resolve({});
      await pending;
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(client.getQueryData(["getBook", "bk_target"])).toEqual(bData);
  },
);
