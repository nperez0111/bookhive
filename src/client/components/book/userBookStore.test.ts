import { afterEach, describe, expect, it } from "bun:test";

import type { UserBookView } from "../../../utils/userBookView";
import { STATUS, applyOptimistic, createUserBookStore } from "./userBookStore";

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

describe("createUserBookStore", () => {
  const props = {
    hiveId: "bk_x",
    title: "Dune",
    authors: "Frank Herbert",
    numPages: null,
    userBook: view(),
  };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const jsonOk = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "text/plain" } });

  it("rolls the view back to the last confirmed state when a write fails", async () => {
    globalThis.fetch = (async () =>
      jsonOk({ success: false, message: "nope" })) as unknown as typeof fetch;
    const store = createUserBookStore(props);
    const ok = await store.update({ status: STATUS.FINISHED });
    expect(ok).toBe(false);
    const s = store.getSnapshot();
    expect(s.view?.status).toBe(STATUS.WANT_TO_READ);
    expect(s.pending).toBe(0);
    expect(s.error).toBeTruthy();
  });

  it("keeps queued writes in order and only the last response replaces the view", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { status?: string; stars?: number };
      seen.push(body.status ?? `stars:${body.stars}`);
      return jsonOk({
        success: true,
        userBook: view({ status: body.status ?? STATUS.WANT_TO_READ, stars: body.stars ?? null }),
      });
    }) as unknown as typeof fetch;
    const store = createUserBookStore(props);
    const a = store.update({ status: STATUS.READING });
    const b = store.update({ stars: 8 });
    expect(store.getSnapshot().pending).toBe(2);
    await Promise.all([a, b]);
    expect(seen).toEqual([STATUS.READING, "stars:8"]);
    const s = store.getSnapshot();
    expect(s.pending).toBe(0);
    expect(s.view?.stars).toBe(8);
  });

  it("waits for queued writes before deleting", async () => {
    const calls: string[] = [];
    let releaseUpdate: (() => void) | null = null;
    const updateStarted = new Promise<void>((r) => (releaseUpdate = r));
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (String(url).includes("/api/update-book")) {
        (releaseUpdate as unknown as () => void)();
        await new Promise((r) => setTimeout(r, 20));
        return jsonOk({ success: true, userBook: view({ stars: 8 }) });
      }
      return jsonOk({ success: true });
    }) as unknown as typeof fetch;

    const store = createUserBookStore(props);
    void store.update({ stars: 8 });
    await updateStarted;
    expect(await store.remove()).toBe(true);
    // The DELETE must not overtake the update — that write would re-create the book.
    expect(calls).toEqual(["POST /api/update-book", "DELETE /books/bk_x"]);
    expect(store.getSnapshot().view).toBeNull();
  });

  it("refuses a write started while the delete is in flight", async () => {
    const calls: string[] = [];
    let releaseDelete: (() => void) | null = null;
    const deleteStarted = new Promise<void>((r) => (releaseDelete = r));
    let unblock: (() => void) | null = null;
    const held = new Promise<void>((r) => (unblock = r));
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (init.method === "DELETE") {
        (releaseDelete as unknown as () => void)();
        await held;
        return jsonOk({ success: true });
      }
      return jsonOk({ success: true, userBook: view({ stars: 8 }) });
    }) as unknown as typeof fetch;

    const store = createUserBookStore(props);
    const removal = store.remove();
    await deleteStarted;
    // A click landing between the DELETE going out and coming back: the server
    // would create the record again, so the store must not send it.
    expect(await store.update({ stars: 8 })).toBe(false);
    (unblock as unknown as () => void)();
    expect(await removal).toBe(true);
    expect(calls).toEqual(["DELETE /books/bk_x"]);
    expect(store.getSnapshot().view).toBeNull();
  });

  it("allows the book to be added again after a successful removal", async () => {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      if (init.method === "DELETE") return jsonOk({ success: true });
      return jsonOk({ success: true, userBook: view({ status: STATUS.WANT_TO_READ }) });
    }) as unknown as typeof fetch;
    const store = createUserBookStore(props);
    expect(await store.remove()).toBe(true);
    expect(store.getSnapshot().view).toBeNull();

    expect(await store.update({ status: STATUS.WANT_TO_READ })).toBe(true);
    expect(store.getSnapshot().view?.status).toBe(STATUS.WANT_TO_READ);
  });

  it("reports a failed removal without clearing the book", async () => {
    globalThis.fetch = (async () => jsonOk({ success: false })) as unknown as typeof fetch;
    const store = createUserBookStore(props);
    expect(await store.remove()).toBe(false);
    expect(store.getSnapshot().view).not.toBeNull();
    expect(store.getSnapshot().error).toBeTruthy();
  });
});
