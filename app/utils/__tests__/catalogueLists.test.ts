import { catalogueListUri, listFormInput, moveListItem, parseListTags } from "../catalogueLists";

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

test("list links accept raw or encoded AT URIs, never numeric ebook shelves", () => {
  const uri = "at://did:plc:reader/social.popfeed.feed.list/abc%20def";
  expect(catalogueListUri(uri)).toBe(uri);
  expect(catalogueListUri(encodeURIComponent(uri))).toBe(uri);
  expect(catalogueListUri("123")).toBeUndefined();
  expect(catalogueListUri("%malformed")).toBeUndefined();
  expect(catalogueListUri(undefined)).toBeUndefined();
  expect(catalogueListUri("at://owner/social.popfeed.feed.listItem/abc")).toBeUndefined();
});
