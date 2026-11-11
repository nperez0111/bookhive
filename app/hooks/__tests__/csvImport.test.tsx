import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";
import { createAuthSessionScope } from "../../context/authSession";
import { queryWrapper } from "../../test/queryHelpers";
import { useCsvImport } from "../useCsvImport";

const mockSession = createAuthSessionScope();
jest.mock("@/context/auth", () => ({
  get authSession() {
    return mockSession;
  },
  getBaseUrl: () => "https://bookhive.test",
}));

const originalXHR = global.XMLHttpRequest;
let client: QueryClient;
let requests: TestXHR[];
class TestXHR {
  upload: {
    onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  status = 200;
  responseText = 'data: {"event":"import-complete","stage":"complete"}\n\n';
  onload?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn();
  abort = jest.fn(() => this.onabort?.());
  constructor() {
    requests.push(this);
  }
}
const input = {
  provider: "goodreads" as const,
  file: { uri: "file:///books.csv", name: "books.csv", size: 10, lastModified: 0 },
};
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  requests = [];
  mockSession.replace({ did: "did:plc:a", handle: "a.test", sid: "sid-a" });
  global.XMLHttpRequest = TestXHR as unknown as typeof XMLHttpRequest;
});
afterEach(() => {
  client.clear();
  global.XMLHttpRequest = originalXHR;
});

it("coalesces same-tick imports before React Query enters pending and releases after completion", async () => {
  const { result } = renderHook(useCsvImport, { wrapper: queryWrapper(() => client) });
  let first!: ReturnType<typeof result.current.mutateAsync>;
  act(() => {
    first = result.current.mutateAsync(input);
    expect(result.current.mutateAsync(input)).toBe(first);
    result.current.mutate(input);
  });
  await waitFor(() => expect(requests[0]?.send).toHaveBeenCalledTimes(1));
  expect(requests).toHaveLength(1);
  await act(async () => {
    requests[0].onload?.();
    await first;
  });
  let next!: typeof first;
  act(() => {
    next = result.current.mutateAsync(input);
  });
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => {
    requests[1].onload?.();
    await next;
  });
});

it.each(["unmount", "session"])(
  "aborts its only active request on %s and ignores late progress",
  async (reason) => {
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const { result, unmount } = renderHook(useCsvImport, { wrapper: queryWrapper(() => client) });
    let pending!: ReturnType<typeof result.current.mutateAsync>;
    act(() => {
      pending = result.current.mutateAsync(input);
    });
    const rejected = expect(pending).rejects.toThrow("Import stopped");
    await waitFor(() => expect(requests[0]?.send).toHaveBeenCalled());
    expect(requests[0].setRequestHeader).toHaveBeenCalledWith("cookie", "sid=sid-a");
    act(() => {
      if (reason === "unmount") unmount();
      else mockSession.replace({ did: "did:plc:b", handle: "b.test", sid: "sid-b" });
    });
    await act(async () => {
      await rejected;
    });
    expect(requests[0].abort).toHaveBeenCalledTimes(1);
    act(() => requests[0].upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 }));
    expect(result.current.uploadProgress).toBe(0);
    if (reason === "session") expect(invalidate).not.toHaveBeenCalled();
  },
);

it("does not start a queued mutation after its screen unmounts", async () => {
  const { result, unmount } = renderHook(useCsvImport, { wrapper: queryWrapper(() => client) });
  let pending!: ReturnType<typeof result.current.mutateAsync>;
  act(() => {
    pending = result.current.mutateAsync(input);
    unmount();
  });
  await expect(pending).rejects.toThrow("screen closed");
  expect(requests).toHaveLength(0);
});
