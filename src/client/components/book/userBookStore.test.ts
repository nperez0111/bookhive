import { describe, expect, it } from "bun:test";

import type { UserBookView } from "../../../utils/userBookView";
import { STATUS, applyOptimistic } from "./userBookStore";

const props = { hiveId: "bk_x", title: "Dune", authors: "Frank Herbert" };

const view = (over: Partial<UserBookView> = {}): UserBookView => ({
  uri: "at://did/buzz.bookhive.book/1",
  cid: "cid1",
  hiveId: "bk_x" as UserBookView["hiveId"],
  title: "Dune",
  authors: "Frank Herbert",
  status: STATUS.WANT_TO_READ,
  owned: true,
  stars: null,
  review: null,
  startedAt: null,
  finishedAt: null,
  bookProgress: null,
  previousReads: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  indexedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("applyOptimistic", () => {
  it("builds a provisional view for a first add, owned by default", () => {
    const next = applyOptimistic(null, { status: STATUS.WANT_TO_READ }, props);
    expect(next.status).toBe(STATUS.WANT_TO_READ);
    expect(next.owned).toBe(true);
    expect(next.title).toBe("Dune");
  });

  it("stamps finishedAt when marking as read, like the server will", () => {
    const next = applyOptimistic(view(), { status: STATUS.FINISHED }, props);
    expect(next.status).toBe(STATUS.FINISHED);
    expect(next.finishedAt).toBeTruthy();
  });

  it("rotates a finished read into previousReads on a re-read", () => {
    const next = applyOptimistic(
      view({
        status: STATUS.FINISHED,
        startedAt: "2026-02-01T00:00:00.000Z",
        finishedAt: "2026-03-01T00:00:00.000Z",
      }),
      { status: STATUS.READING },
      props,
    );
    expect(next.status).toBe(STATUS.READING);
    expect(next.finishedAt).toBeNull();
    expect(next.startedAt).not.toBe("2026-02-01T00:00:00.000Z");
    expect(next.previousReads).toEqual([
      { startedAt: "2026-02-01T00:00:00.000Z", finishedAt: "2026-03-01T00:00:00.000Z" },
    ]);
  });

  it("infers reading from progress and finished from a finish date", () => {
    const a = applyOptimistic(view({ status: null }), { bookProgress: { percent: 10 } }, props);
    expect(a.status).toBe(STATUS.READING);
    expect(a.bookProgress?.percent).toBe(10);

    const b = applyOptimistic(
      view({ status: STATUS.READING }),
      { finishedAt: "2026-05-05" },
      props,
    );
    expect(b.status).toBe(STATUS.FINISHED);
    expect(b.finishedAt?.startsWith("2026-05-05")).toBe(true);
  });

  it("forces progress to 100% on a finished book", () => {
    const next = applyOptimistic(
      view({ bookProgress: { percent: 40, totalPages: 300, currentPage: 120, updatedAt: "x" } }),
      { status: STATUS.FINISHED },
      props,
    );
    expect(next.bookProgress?.percent).toBe(100);
    expect(next.bookProgress?.currentPage).toBe(300);
  });

  it("cannot clear a review with an empty string (matches the server)", () => {
    const next = applyOptimistic(view({ review: "Good." }), { review: "" }, props);
    expect(next.review).toBe("Good.");
  });
});
