import { act, renderHook } from "@testing-library/react-native";
import { deferred } from "../../test/queryHelpers";
import { createAuthSessionScope } from "../../context/authSession";
import { useDeleteAccount, useResyncBooks } from "../useAccount";
import { useCsvImport } from "../useCsvImport";

const mockSession = createAuthSessionScope();
const mockTransport = jest.fn();
const mockSignOut = jest.fn();
const mockInvalidate = jest.fn();
const mockCancel = jest.fn();
const mockClear = jest.fn();
let mockOptions: any;

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidate,
    cancelQueries: mockCancel,
    clear: mockClear,
  }),
  useMutation: (options: any) => {
    mockOptions = options;
    return {
      mutate: (input: unknown) => options.mutationFn(input),
      mutateAsync: (input: unknown) => options.mutationFn(input),
    };
  },
}));
jest.mock("@/context/auth", () => ({
  get authSession() {
    return mockSession;
  },
  getBaseUrl: () => "https://bookhive.test",
  useAuth: () => ({ signOut: mockSignOut }),
  createSessionFetch: () => {
    const scope = mockSession.capture();
    return async (...args: unknown[]) => {
      scope.assertCurrent();
      const result = await mockTransport(scope.state?.sid, ...args);
      scope.assertCurrent();
      return result;
    };
  },
}));

const account = (name: string) => ({
  did: `did:plc:${name}`,
  handle: `${name}.test`,
  sid: `${name}-sid`,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.replace(account("a"));
  mockTransport.mockResolvedValue({ success: true });
  mockCancel.mockResolvedValue(undefined);
});

test.each([useResyncBooks, useDeleteAccount])(
  "account writes captured in A's render cannot start as B",
  async (hook) => {
    renderHook(() => hook());
    const write = mockOptions.mutationFn;
    mockSession.replace(account("b"));
    await expect(write("a.test")).rejects.toThrow("session changed");
    expect(mockTransport).not.toHaveBeenCalled();
  },
);

test("deletion signs out A synchronously, never B from a stale callback or delayed persistence", async () => {
  renderHook(() => useDeleteAccount());
  const staleResult = await mockOptions.mutationFn("a.test");
  mockSession.replace(account("b"));
  await mockOptions.onSuccess(staleResult);
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockSession.state).toEqual(account("b"));

  mockSession.replace(account("a"));
  renderHook(() => useDeleteAccount());
  const result = await mockOptions.mutationFn("a.test");
  const persistence = deferred();
  // Match AuthProvider: replace the session before awaiting credential storage.
  mockSignOut.mockImplementationOnce(async () => {
    mockSession.replace(null);
    await persistence.promise;
  });
  const success = mockOptions.onSuccess(result);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockSession.state).toBeNull();
  mockSession.replace(account("b"));
  persistence.resolve();
  await success;
  expect(mockSession.state).toEqual(account("b"));
  expect(mockCancel).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});

test("resync completion does not invalidate a replacement account", async () => {
  renderHook(() => useResyncBooks());
  const result = await mockOptions.mutationFn();
  mockSession.replace(account("b"));
  await mockOptions.onSuccess(result);
  expect(mockInvalidate).not.toHaveBeenCalled();
});

test.each([
  [useResyncBooks, undefined, "/xrpc/buzz.bookhive.resyncAccount", {}],
  [useDeleteAccount, "a.test", "/xrpc/buzz.bookhive.deleteAccount", { confirmHandle: "a.test" }],
] as const)("account tools use validated XRPC procedures", async (hook, input, path, body) => {
  renderHook(() => hook());
  await mockOptions.mutationFn(input);
  expect(mockTransport).toHaveBeenCalledWith(
    "a-sid",
    path,
    expect.objectContaining({ method: "POST", body, retry: 0 }),
  );
  expect(mockOptions.retry).toBe(false);
});

test.each([useResyncBooks, useDeleteAccount])(
  "unsuccessful account responses cannot trigger success callbacks",
  async (hook) => {
    mockTransport.mockResolvedValue({ success: false });
    renderHook(() => hook());
    await expect(mockOptions.mutationFn("a.test")).rejects.toThrow("Could not");
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  },
);

test("CSV captures credentials once, aborts on logout, and ignores stale progress/cache callbacks", async () => {
  const originalXHR = global.XMLHttpRequest;
  const xhr: any = {
    upload: {},
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    send: jest.fn(),
    abort: jest.fn(() => xhr.onabort()),
    status: 200,
    responseText: "",
  };
  global.XMLHttpRequest = jest.fn(() => xhr) as unknown as typeof XMLHttpRequest;
  try {
    const { result } = renderHook(() => useCsvImport());
    let upload!: Promise<unknown>;
    act(() => {
      upload = result.current.mutateAsync({
        provider: "goodreads",
        file: { uri: "file:///books.csv", name: "books.csv", size: 100, lastModified: 0 },
      });
    });
    const failed = expect(upload).rejects.toThrow("Import stopped");
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("cookie", "sid=a-sid");
    const captured = mockSession.capture();
    act(() => {
      mockSession.replace(account("b"));
    });
    await failed;
    expect(xhr.abort).toHaveBeenCalledTimes(1);
    act(() => {
      xhr.upload.onprogress({ lengthComputable: true, loaded: 90, total: 100 });
    });
    expect(result.current.uploadProgress).toBe(0);
    await mockOptions.onSettled(undefined, new Error("aborted"), { scope: captured });
    expect(mockInvalidate).not.toHaveBeenCalled();
  } finally {
    global.XMLHttpRequest = originalXHR;
  }
});

test.each(["mutate", "mutateAsync"] as const)(
  "retained CSV %s callback from A cannot start an upload as B",
  (method) => {
    const originalXHR = global.XMLHttpRequest;
    const constructXHR = jest.fn();
    global.XMLHttpRequest = constructXHR as unknown as typeof XMLHttpRequest;
    try {
      const { result, rerender } = renderHook(() => useCsvImport());
      const retainedCallback = result.current[method];
      act(() => {
        mockSession.replace(account("b"));
      });
      rerender({});
      expect(() =>
        retainedCallback({
          provider: "goodreads",
          file: { uri: "file:///books.csv", name: "books.csv", size: 100, lastModified: 0 },
        }),
      ).toThrow("session changed");
      expect(constructXHR).not.toHaveBeenCalled();
      expect(mockInvalidate).not.toHaveBeenCalled();
    } finally {
      global.XMLHttpRequest = originalXHR;
    }
  },
);
