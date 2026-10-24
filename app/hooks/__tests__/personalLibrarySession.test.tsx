import { act, renderHook, waitFor } from "@testing-library/react-native";
import { notifyManager, QueryClient } from "@tanstack/react-query";
import { deferred, queryWrapper } from "../../test/queryHelpers";
import { authSession } from "@/context/auth";
import {
  useDeletePersonalBook,
  useDeleteSyncDocument,
  useDismissSyncDocument,
  useUploadPersonalBook,
} from "../useBookhiveQuery";

const mockSent = jest.fn();
jest.mock("@/utils/bookMutations", () => ({}));
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
        mockSent(session.state, ...args);
        return {};
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
  mockSent.mockClear();
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
