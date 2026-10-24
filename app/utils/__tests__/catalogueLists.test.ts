import { QueryClient } from "@tanstack/react-query";
import {
  catalogueListUri,
  listFormInput,
  moveListItem,
  parseListTags,
  restoreListSnapshots,
} from "../catalogueLists";

describe("public catalogue list forms", () => {
  test("preserves explicit clears and unordered choice", () => {
    expect(listFormInput(" Favorites ", "  ", false, "")).toEqual({
      name: "Favorites",
      description: "",
      ordered: false,
      tags: [],
    });
  });

  test("normalizes tags and enforces lexicon lengths", () => {
    expect(parseListTags(" fiction, favorites,fiction, , ")).toEqual(["fiction", "favorites"]);
    expect(() => parseListTags("a".repeat(51))).toThrow();
    expect(() => listFormInput("  ", "", true, "")).toThrow();
    expect(() => listFormInput("a".repeat(101), "", true, "")).toThrow();
    expect(() => listFormInput("A", "x".repeat(501), true, "")).toThrow();
    expect(parseListTags("🐝".repeat(50))).toHaveLength(1);
  });
});

test("reorder uses stable item URIs, even for duplicated or missing catalogue books", () => {
  const items = [
    { uri: "at://owner/social.popfeed.feed.listItem/1", hiveId: "bk_same" },
    { uri: "at://owner/social.popfeed.feed.listItem/2", hiveId: "bk_same" },
    { uri: "at://owner/social.popfeed.feed.listItem/3" },
  ];
  expect(moveListItem(items, items[1]!.uri, -1).map((item) => item.uri)).toEqual([
    items[1]!.uri,
    items[0]!.uri,
    items[2]!.uri,
  ]);
  expect(moveListItem(items, items[2]!.uri, -1)[1]).toBe(items[2]);
  expect(moveListItem(items, items[0]!.uri, -1)).toBe(items);
  expect(moveListItem(items, items[2]!.uri, 1)).toBe(items);
  expect(moveListItem(items, "missing", 1)).toBe(items);
  expect(items[0]!.uri.endsWith("/1")).toBe(true);
});

test("rollback restores each owner-keyed query without overwriting another owner's lists", () => {
  const client = new QueryClient();
  const alice = { lists: [{ uri: "alice-list", name: "Alice" }] };
  const bob = { lists: [{ uri: "bob-list", name: "Bob" }] };
  client.setQueryData(["userLists", "alice"], alice);
  client.setQueryData(["userLists", "bob"], bob);
  const snapshots = client.getQueriesData({ queryKey: ["userLists"] });
  client.setQueriesData({ queryKey: ["userLists"] }, { lists: [] });
  restoreListSnapshots(client, snapshots);
  expect(client.getQueryData<typeof alice>(["userLists", "alice"])).toEqual(alice);
  expect(client.getQueryData<typeof bob>(["userLists", "bob"])).toEqual(bob);
  expect(client.getQueryData(["userLists"])).toBeUndefined();
  client.clear();
});

test("detail rollback only restores the affected AT URI", () => {
  const client = new QueryClient();
  const key = ["listDetails", "at://owner/social.popfeed.feed.list/1"];
  const otherKey = ["listDetails", "at://owner/social.popfeed.feed.list/2"];
  const detail = { items: [{ uri: "one" }, { uri: "two" }] };
  client.setQueryData(key, detail);
  client.setQueryData(otherKey, { items: [] });
  const snapshots = client.getQueriesData({ queryKey: key, exact: true });
  client.setQueryData(key, { items: [{ uri: "two" }] });
  restoreListSnapshots(client, snapshots);
  expect(client.getQueryData<typeof detail>(key)).toEqual(detail);
  expect(client.getQueryData<typeof detail>(otherKey)).toEqual({ items: [] });
  client.clear();
});

test("list links accept raw or encoded AT URIs, never numeric ebook shelves", () => {
  const uri = "at://did:plc:reader/social.popfeed.feed.list/abc%20def";
  expect(catalogueListUri(uri)).toBe(uri);
  expect(catalogueListUri(encodeURIComponent(uri))).toBe(uri);
  expect(catalogueListUri("123")).toBeUndefined();
  expect(catalogueListUri("%malformed")).toBeUndefined();
  expect(catalogueListUri(undefined)).toBeUndefined();
  expect(catalogueListUri("at://owner/social.popfeed.feed.listItem/abc")).toBeUndefined();
});
