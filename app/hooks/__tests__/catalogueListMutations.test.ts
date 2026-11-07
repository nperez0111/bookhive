import { QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { deferred } from "../../test/queryHelpers";
import { authFetch, authSession } from "@/context/auth";
import {
  useCreateList,
  useUpdateList,
  useDeleteList,
  useAddToList,
  useRemoveFromList,
  useReorderList,
} from "../useBookhiveQuery";

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: jest.fn(),
  useMutation: jest.fn((options) => options),
}));
jest.mock("@/context/auth", () => {
  const { createAuthSessionScope } = jest.requireActual("@/context/authSession");
  const session = createAuthSessionScope();
  const network = jest.fn();
  return {
    authSession: session,
    authFetch: network,
    createSessionFetch: () => {
      const captured = session.capture();
      return async (...args: unknown[]) => {
        captured.assertCurrent();
        const result = await network(...args);
        captured.assertCurrent();
        return result;
      };
    },
  };
});
jest.mock("@/utils/bookMutations", () => ({}));
jest.mock("@/utils/personalLibraryQuery", () => ({}));

type Options = {
  retry: boolean;
  mutationFn: (input: any) => Promise<unknown>;
  onMutate?: (input: any) => Promise<unknown>;
  onError?: (error: unknown, input: any, context: any) => void;
  onSuccess?: (data: any, input: any) => void;
  onSettled?: (data: any, error: unknown, input: any) => unknown;
};
const uri = "at://did:plc:alice/social.popfeed.feed.list/one";
const itemUri = "at://did:plc:alice/social.popfeed.feed.listItem/one";
const alice = { did: "did:plc:alice", handle: "alice.test", sid: "alice-session" };
const bob = { did: "did:plc:bob", handle: "bob.test", sid: "bob-session" };
const writes = [
  { name: "create", hook: useCreateList, input: { name: "Favorites" } },
  { name: "update", hook: useUpdateList, input: { uri, name: "New name" } },
  { name: "delete", hook: useDeleteList, input: { uri } },
  { name: "add", hook: useAddToList, input: { listUri: uri, hiveId: "bk_one" } },
  { name: "remove", hook: useRemoveFromList, input: { listUri: uri, itemUri } },
  { name: "reorder", hook: useReorderList, input: { listUri: uri, itemUris: [itemUri] } },
];
let client: QueryClient;
function optionsFor(hook: () => unknown): Options {
  hook();
  return (useMutation as jest.Mock).mock.calls.at(-1)![0];
}

beforeEach(() => {
  jest.clearAllMocks();
  authSession.replace(alice);
  client = new QueryClient();
  (useQueryClient as jest.Mock).mockReturnValue(client);
  client.setQueryData(["userLists", alice.did], { lists: [{ uri, name: "Original" }] });
  client.setQueryData(["listDetails", uri], {
    list: { uri, name: "Original", itemCount: 1 },
    items: [{ uri: itemUri, position: 0 }],
  });
});
afterEach(() => client.clear());

test("metadata patches preserve omitted fields and apply explicit clears in both caches", async () => {
  const list = { uri, name: "Original", description: "Keep me", ordered: true, tags: ["old"] };
  client.setQueryData(["userLists", alice.did], { lists: [list] });
  client.setQueryData(["listDetails", uri], { list, items: [] });
  const options = optionsFor(useUpdateList);
  await options.onMutate!({ uri, name: "Renamed" });
  expect(client.getQueryData<any>(["listDetails", uri]).list).toEqual({ ...list, name: "Renamed" });
  expect(client.getQueryData<any>(["userLists", alice.did]).lists[0]).toEqual({
    ...list,
    name: "Renamed",
  });

  await options.onMutate!({ uri, description: "", ordered: false, tags: [] });
  const cleared = { ...list, name: "Renamed", description: "", ordered: false, tags: [] };
  expect(client.getQueryData<any>(["listDetails", uri]).list).toEqual(cleared);
  expect(client.getQueryData<any>(["userLists", alice.did]).lists[0]).toEqual(cleared);
  const invalidate = jest.spyOn(client, "invalidateQueries");
  (authFetch as jest.Mock).mockResolvedValueOnce({ uri, cid: "saved" });
  const input = { uri, description: "", ordered: false, tags: [] };
  const result = await options.mutationFn(input);
  await options.onSettled!(result, null, input);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["userLists"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["listDetails", uri] });
});

test("metadata failure restores exact detail and multiple owner-keyed snapshots", async () => {
  const aliceKey = ["userLists", alice.did];
  const bobKey = ["userLists", bob.did];
  const bobLists = { lists: [{ uri: "at://bob/other", name: "Bob's list" }] };
  client.setQueryData(bobKey, bobLists);
  const originalAlice = client.getQueryData(aliceKey);
  const originalDetails = client.getQueryData(["listDetails", uri]);
  const options = optionsFor(useUpdateList);
  const input = { uri, description: "", ordered: false, tags: [] };
  const context = await options.onMutate!(input);
  options.onError!(new Error("Save failed"), input, context);
  expect(client.getQueryData(aliceKey)).toEqual(originalAlice);
  expect(client.getQueryData(bobKey)).toEqual(bobLists);
  expect(client.getQueryData(["listDetails", uri])).toEqual(originalDetails);
});

test.each(writes)(
  "$name disables retries and never starts A's request using B's session",
  async ({ hook, input }) => {
    const options = optionsFor(hook);
    expect(options.retry).toBe(false);
    authSession.replace(null);
    authSession.replace(bob);
    await expect(options.mutationFn(input)).rejects.toThrow("session changed");
    expect(authFetch).not.toHaveBeenCalled();
  },
);

test.each(writes.filter(({ name }) => ["update", "delete", "remove", "reorder"].includes(name)))(
  "$name cannot resume onMutate cache writes after cancellation",
  async ({ hook, input }) => {
    const options = optionsFor(hook);
    const gate = deferred();
    const cancel = jest.spyOn(client, "cancelQueries").mockReturnValueOnce(gate.promise);
    const pending = options.onMutate!(input);
    authSession.replace(bob);
    client.clear();
    const invalidate = jest.spyOn(client, "invalidateQueries");
    gate.resolve();
    await expect(pending).rejects.toThrow("session changed");
    options.onError?.(new Error("cancelled"), input, undefined);
    await options.onSettled?.(undefined, new Error("cancelled"), input);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(authFetch).not.toHaveBeenCalled();
  },
);

test.each(writes)(
  "$name late completion cannot restore cleared snapshots or refetch as B",
  async ({ hook, input }) => {
    const options = optionsFor(hook);
    const context = await options.onMutate?.(input);
    const gate = deferred();
    (authFetch as jest.Mock).mockReturnValueOnce(gate.promise);
    const request = options.mutationFn(input);
    authSession.replace(null);
    authSession.replace(bob);
    client.clear();
    const invalidate = jest.spyOn(client, "invalidateQueries");
    gate.resolve();
    await expect(request).rejects.toThrow("session changed");
    options.onError?.(new Error("cancelled"), input, context);
    options.onSuccess?.({}, input);
    await options.onSettled?.(undefined, new Error("cancelled"), input);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(authFetch).toHaveBeenCalledTimes(1);
  },
);
