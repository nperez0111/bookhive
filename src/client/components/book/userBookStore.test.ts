import { afterEach, describe, expect, it, spyOn } from "bun:test";

import type { UserBookView } from "../../../core/userBookView";
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

  it("paints completion from the final page without waiting for the save", () => {
    const next = applyOptimistic(
      view({ status: STATUS.READING }),
      { bookProgress: { currentPage: 658, totalPages: 658 } },
      props,
    );
    expect(next.status).toBe(STATUS.FINISHED);
    expect(next.finishedAt).toBeTruthy();
    expect(next.bookProgress?.percent).toBe(100);
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

  it("stamps no date when the payload asserts no status", () => {
    // A stars/owned/review write carries no status, and the server leaves the dates alone.
    const next = applyOptimistic(
      view({ status: STATUS.READING, startedAt: null }),
      { stars: 8 },
      props,
    );
    expect(next.startedAt).toBeNull();
    expect(next.status).toBe(STATUS.READING);
  });

  it("does not restamp the start date of a book already reading", () => {
    const next = applyOptimistic(
      view({ status: STATUS.READING, startedAt: "2026-03-01T00:00:00.000Z" }),
      { status: STATUS.READING, bookProgress: { currentPage: 12 } },
      props,
    );
    expect(next.startedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("does not downgrade a finished book when only a date is edited", () => {
    const next = applyOptimistic(
      view({
        status: STATUS.FINISHED,
        startedAt: "2026-02-01T00:00:00.000Z",
        finishedAt: "2026-03-01T00:00:00.000Z",
      }),
      { startedAt: "2026-02-05" },
      props,
    );
    expect(next.status).toBe(STATUS.FINISHED);
    expect(next.finishedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("stamps a fresh finish date when a book is finished again", () => {
    const next = applyOptimistic(
      view({ status: STATUS.READING, finishedAt: "2020-02-01T00:00:00.000Z" }),
      { status: STATUS.FINISHED },
      props,
    );
    expect(next.finishedAt).not.toBe("2020-02-01T00:00:00.000Z");
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

  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  };

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

  it("keeps queued writes in order and reconciles the final response", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      // `RequestInit["body"]` is a `BodyInit` union, so `String()` on it would
      // silently produce "[object Object]" if the store ever stopped sending a
      // JSON string. Narrow instead, so that change fails here.
      if (typeof init.body !== "string") throw new Error("expected a JSON string body");
      const body = JSON.parse(init.body) as { status?: string; stars?: number };
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

  it("drops only the failed edit and preserves the later queued projection", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let calls = 0;
    globalThis.fetch = (async () =>
      ++calls === 1 ? first.promise : second.promise) as unknown as typeof fetch;
    const store = createUserBookStore(props);
    const a = store.update({ status: STATUS.FINISHED });
    const b = store.update({ stars: 8 }, { explicitSave: true });
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(store.getSnapshot().view?.status).toBe(STATUS.FINISHED);
    expect(store.getSnapshot().view?.stars).toBe(8);

    first.resolve(jsonOk({ success: false, message: "nope" }));
    expect(await a).toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      confirmed: props.userBook,
      view: { status: STATUS.WANT_TO_READ, finishedAt: null, stars: 8 },
      pending: 1,
      savedAt: null,
    });
    expect(store.getSnapshot().error).toBeTruthy();

    const canonical = view({ stars: 8, cid: "cid2" });
    second.resolve(jsonOk({ success: true, userBook: canonical }));
    expect(await b).toBe(true);
    expect(calls).toBe(2);
    expect(store.getSnapshot()).toMatchObject({
      view: canonical,
      confirmed: canonical,
      pending: 0,
    });
    expect(store.getSnapshot().savedAt).not.toBeNull();
  });

  it("replays later edits over the first canonical success", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let calls = 0;
    globalThis.fetch = (async () =>
      ++calls === 1 ? first.promise : second.promise) as unknown as typeof fetch;
    const store = createUserBookStore(props);
    const a = store.update({ status: STATUS.READING });
    const b = store.update({ stars: 8 });
    const canonical = view({
      status: STATUS.READING,
      cid: "cid2",
      startedAt: "2026-04-03T00:00:00.000Z",
      review: "Canonical review",
      bookProgress: { currentPage: 42, totalPages: 300, updatedAt: "server" },
    });
    first.resolve(jsonOk({ success: true, userBook: canonical }));
    expect(await a).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      confirmed: canonical,
      view: { ...canonical, stars: 8 },
      pending: 1,
      error: null,
    });

    second.resolve(jsonOk({ success: false, message: "nope" }));
    expect(await b).toBe(false);
    expect(store.getSnapshot().view).toEqual(canonical);
    expect(store.getSnapshot().pending).toBe(0);
  });

  for (const status of [STATUS.READING, STATUS.FINISHED]) {
    it.each([true, false])(
      `preserves the pending ${status} edit's enqueue date across midnight (success: %s)`,
      async (success) => {
        const timestamp = "2026-11-08T23:59:59.000Z";
        const clock = spyOn(Date.prototype, "toISOString").mockReturnValue(timestamp);
        try {
          const first = deferred<Response>();
          const second = deferred<Response>();
          let calls = 0;
          globalThis.fetch = (async () =>
            ++calls === 1 ? first.promise : second.promise) as unknown as typeof fetch;
          const store = createUserBookStore(props);
          const a = store.update({ owned: false });
          const b = store.update({ status, bookProgress: { percent: 10 } });
          const dateField = status === STATUS.READING ? "startedAt" : "finishedAt";
          expect(store.getSnapshot().view?.[dateField]).toBe(timestamp);
          expect(store.getSnapshot().view?.bookProgress?.updatedAt).toBe(timestamp);

          clock.mockReturnValue("2026-11-09T00:00:01.000Z");
          first.resolve(jsonOk({ success, userBook: view({ owned: false }) }));
          expect(await a).toBe(success);
          expect(store.getSnapshot().pending).toBe(1);
          expect(store.getSnapshot().view?.[dateField]).toBe(timestamp);
          expect(store.getSnapshot().view?.bookProgress?.updatedAt).toBe(timestamp);

          const canonical = store.getSnapshot().view;
          second.resolve(jsonOk({ success: true, userBook: canonical }));
          expect(await b).toBe(true);
        } finally {
          clock.mockRestore();
        }
      },
    );
  }

  it("copies queued fields and nested progress before callers can mutate them", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const sent: unknown[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("expected a JSON string body");
      sent.push(JSON.parse(init.body));
      return sent.length === 1 ? first.promise : second.promise;
    }) as unknown as typeof fetch;
    const store = createUserBookStore(props);
    const a = store.update({ owned: false });
    const fields = { stars: 8, bookProgress: { percent: 10 } };
    const b = store.update(fields);
    fields.stars = 2;
    fields.bookProgress.percent = 100;

    first.resolve(jsonOk({ success: true, userBook: view({ owned: false }) }));
    expect(await a).toBe(true);
    expect(store.getSnapshot().view).toMatchObject({
      stars: 8,
      status: STATUS.READING,
      bookProgress: { percent: 10 },
    });
    const canonical = store.getSnapshot().view;
    second.resolve(jsonOk({ success: true, userBook: canonical }));
    expect(await b).toBe(true);
    expect(sent[1]).toEqual({ hiveId: props.hiveId, stars: 8, bookProgress: { percent: 10 } });
  });

  it.each([true, false])(
    "blocks updates and duplicate deletes throughout removal (success: %s)",
    async (success) => {
      const updateResponse = deferred<Response>();
      const deleteResponse = deferred<Response>();
      const deleteStarted = deferred<void>();
      const calls: string[] = [];
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        calls.push(init.method!);
        if (init.method === "DELETE") {
          deleteStarted.resolve();
          return deleteResponse.promise;
        }
        return (await updateResponse.promise).clone();
      }) as unknown as typeof fetch;
      const store = createUserBookStore(props);
      const save = store.update({ stars: 8 });
      const removal = store.remove();
      expect(await store.update({ owned: false })).toBe(false);
      expect(await store.remove()).toBe(false);
      expect(calls).toEqual(["POST"]);

      const canonical = view({ stars: 8 });
      updateResponse.resolve(jsonOk({ success: true, userBook: canonical }));
      expect(await save).toBe(true);
      await deleteStarted.promise;
      expect(store.getSnapshot().view).toEqual(canonical);
      expect(await store.update({ stars: 2 })).toBe(false);
      expect(await store.remove()).toBe(false);
      expect(calls).toEqual(["POST", "DELETE"]);

      deleteResponse.resolve(jsonOk({ success }));
      expect(await removal).toBe(success);
      expect(store.getSnapshot().view).toEqual(success ? null : canonical);
      if (!success) expect(store.getSnapshot().error).toBeTruthy();

      expect(await store.update({ stars: 8 })).toBe(true);
      expect(calls).toEqual(["POST", "DELETE", "POST"]);
    },
  );

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
    // A click landing between the DELETE going out and coming back: the server would create the record again, so the store must not send it.
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
