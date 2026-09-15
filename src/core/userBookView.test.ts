/**
 * `UserBookView` is the one shape every book-state write returns and the read
 * answers with, so a client can update optimistically and reconcile against
 * what was actually written. Two things about it are load-bearing.
 */
import { describe, it, expect } from "bun:test";
import type { UserBook } from "../types";
import { toUserBookView } from "./userBookView";

const userBook = (over: Partial<UserBook> = {}) =>
  ({
    uri: "at://did:plc:me/buzz.bookhive.book/abc",
    cid: "bafy123",
    userDid: "did:plc:me",
    hiveId: "bk_abc",
    title: "Dune",
    authors: "Frank Herbert",
    status: "buzz.bookhive.defs#finished",
    owned: 1,
    stars: 8,
    review: "Good",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-05T00:00:00.000Z",
    bookProgress: null,
    previousReads: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    indexedAt: "2026-01-05T00:00:00.000Z",
    record: { some: "record" },
    ...over,
  }) as unknown as UserBook;

describe("toUserBookView", () => {
  it("converts `owned` from SQLite's integer to a boolean", () => {
    // The column is 0/1; a client that does `if (book.owned)` on the raw row
    // would be right by accident and wrong the moment it is serialised.
    expect(toUserBookView(userBook({ owned: 1 })).owned).toBe(true);
    expect(toUserBookView(userBook({ owned: 0 })).owned).toBe(false);
  });

  it("excludes the raw PDS record", () => {
    // It carries blob refs, which are meaningless to a client and large.
    const view = toUserBookView(userBook());
    expect(view).not.toHaveProperty("record");
    expect(JSON.stringify(view)).not.toContain("some");
  });

  it("excludes userDid", () => {
    // The viewer already knows whose book this is; publishing it invites a
    // caller to treat one user's row as another's.
    expect(toUserBookView(userBook())).not.toHaveProperty("userDid");
  });

  it("carries both timestamps, so a client can order by one and label with the other", () => {
    const view = toUserBookView(userBook());
    expect(view.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(view.indexedAt).toBe("2026-01-05T00:00:00.000Z");
  });

  it("normalises absent optional fields to null, not undefined", () => {
    // `undefined` disappears from a JSON body, so a client merging a response
    // into local state cannot tell "unchanged" from "cleared".
    const view = toUserBookView(
      userBook({
        status: undefined,
        stars: undefined,
        review: undefined,
        startedAt: undefined,
        finishedAt: undefined,
        bookProgress: undefined,
        previousReads: undefined,
      }),
    );
    expect(view.status).toBeNull();
    expect(view.stars).toBeNull();
    expect(view.review).toBeNull();
    expect(view.startedAt).toBeNull();
    expect(view.finishedAt).toBeNull();
    expect(view.bookProgress).toBeNull();
    expect(view.previousReads).toBeNull();
  });

  it("keeps stars on the 1-10 scale it is stored in", () => {
    // Three scales are in play (`stars` 1-10, `hive_book.rating` x1000,
    // display 0-5). The view is not the place that converts.
    expect(toUserBookView(userBook({ stars: 8 })).stars).toBe(8);
  });
});
