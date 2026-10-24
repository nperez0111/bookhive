import { nextFeedCursor, nextOffset, uniqueBooks } from "../discoveryPagination";

describe("discovery pagination", () => {
  it("advances a full offset page using the server offset", () => {
    expect(nextOffset({ books: [1, 2], offset: 4 }, 2, 2)).toBe(4);
    expect(nextOffset({ books: [1, 2] }, 2, 2)).toBe(4);
  });

  it("stops on short pages and non-advancing offsets", () => {
    expect(nextOffset({ books: [1], offset: 3 }, 2, 2)).toBeUndefined();
    expect(nextOffset({ books: [], offset: 2 }, 2, 2)).toBeUndefined();
    expect(nextOffset({ books: [1, 2], offset: 2 }, 2, 2)).toBeUndefined();
  });

  it("requires hasMore and a fresh opaque feed cursor", () => {
    expect(nextFeedCursor({ hasMore: true, cursor: "next" }, [""])).toBe("next");
    expect(nextFeedCursor({ hasMore: false, cursor: "next" }, [""])).toBeUndefined();
    expect(nextFeedCursor({ hasMore: true }, [""])).toBeUndefined();
    expect(nextFeedCursor({ hasMore: true, cursor: "old" }, ["", "old", "new"])).toBeUndefined();
  });

  it("appends catalogue pages without replacing previous books or duplicating overlap", () => {
    const pages = [
      {
        books: [
          { id: "a", title: "Newest state" },
          { id: "b", title: "B" },
        ],
      },
      {
        books: [
          { id: "a", title: "Old state" },
          { id: "c", title: "C" },
        ],
      },
    ];
    expect(uniqueBooks(pages)).toEqual([
      { id: "a", title: "Newest state" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ]);
    expect(pages[1].books).toHaveLength(2);
  });
});
