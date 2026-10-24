/// <reference types="jest" />
import { QueryClient } from "@tanstack/react-query";
import {
  bookMutationQueue,
  createBookMutationQueue,
  requireMutationSuccess,
} from "../bookMutations";
import type { UserBookView } from "../../../src/core/userBookView";
import type { GetBook, HiveId } from "../../../src/types";
import { FINISHED, READING } from "../../../src/constants";

const id = "bk_test" as HiveId;
const key = ["getBook", id];
const canonical = (patch: Partial<UserBookView> = {}): UserBookView => ({
  uri: "at://reader/book/1",
  cid: "cid",
  hiveId: id,
  title: "Test",
  authors: "Author",
  status: READING,
  owned: true,
  stars: null,
  review: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: null,
  bookProgress: null,
  previousReads: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  indexedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("mobile book mutation queue", () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    client.setQueryData(key, {
      book: { id, title: "Catalogue title", authors: "Author" },
      reviews: [],
      comments: [],
      status: READING,
      owned: true,
      stars: 2,
    });
  });
  afterEach(() => client.clear());
  const data = (client: QueryClient) => client.getQueryData<GetBook.$output>(key)!;

  it("shares the queue across hook instances but isolates epoch-scoped clients", () => {
    expect(bookMutationQueue(client)).toBe(bookMutationQueue(client));
    const other = new QueryClient();
    expect(bookMutationQueue(client)).not.toBe(bookMutationQueue(other));
    other.clear();
  });

  it("sends serially and rebases newer edits over the complete canonical response", async () => {
    const queue = createBookMutationQueue(client);
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const fetch = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = queue.update({ hiveId: id, bookProgress: { percent: 100, updatedAt: "now" } }, fetch);
    const b = queue.update({ hiveId: id, stars: 8 }, fetch);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(data(client).stars).toBe(8);
    expect(data(client).status).toBe(FINISHED);
    first.resolve({
      success: true,
      userBook: canonical({ status: FINISHED, finishedAt: "server-date", stars: 4 }),
    });
    await a;
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(data(client).stars).toBe(8);
    expect(data(client).status).toBe(FINISHED);
    expect(data(client).finishedAt).toBe("server-date");
    second.resolve({
      success: true,
      userBook: canonical({ stars: 8, previousReads: [{ finishedAt: "prior-date" }] }),
    });
    await b;
    expect(data(client).status).toBe(READING);
    expect(data(client).finishedAt).toBeUndefined();
    expect(data(client).bookProgress).toBeUndefined();
    expect(data(client).previousReads).toEqual([{ finishedAt: "prior-date" }]);
    expect(data(client).book.title).toBe("Catalogue title");
    expect(fetch.mock.calls[0][1].retry).toBe(false);
  });

  it.each([
    { success: false, message: "Write rejected" },
    { success: true },
    { success: true, userBook: null },
    { success: true, userBook: {} },
    { success: true, userBook: canonical({ hiveId: "bk_other" as HiveId }) },
  ])("rejects unconfirmed canonical response %# and rolls back", async (response) => {
    const queue = createBookMutationQueue(client);
    const before = data(client);
    const fetch = jest.fn().mockResolvedValue(response);
    await expect(queue.update({ hiveId: id, stars: 10 }, fetch)).rejects.toThrow();
    expect(data(client)).toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rolls back only the failed edit and preserves a later optimistic choice", async () => {
    const queue = createBookMutationQueue(client);
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const fetch = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = queue.update({ hiveId: id, stars: 10 }, fetch);
    const rejected = a.catch((error: unknown) => error);
    const b = queue.update({ hiveId: id, review: "later edit" }, fetch);
    await tick();
    first.reject(new Error("offline"));
    expect(await rejected).toEqual(new Error("offline"));
    expect(data(client).stars).toBe(2);
    expect(data(client).review).toBe("later edit");
    second.resolve({ success: true, userBook: canonical({ stars: 2, review: "later edit" }) });
    await b;
    expect(data(client).review).toBe("later edit");
  });

  it("waits for updates before deletion, blocks edits, and clears only confirmed deletion", async () => {
    const queue = createBookMutationQueue(client);
    const save = deferred<unknown>();
    const remove = deferred<unknown>();
    const fetch = jest.fn().mockReturnValueOnce(save.promise).mockReturnValueOnce(remove.promise);
    const a = queue.update({ hiveId: id, stars: 8 }, fetch);
    const deletion = queue.remove(id, fetch);
    await expect(queue.update({ hiveId: id, stars: 3 }, fetch)).rejects.toThrow("being removed");
    await expect(queue.remove(id, fetch)).rejects.toThrow("being removed");
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(data(client).status).toBe(READING);
    save.resolve({ success: true, userBook: canonical({ stars: 8 }) });
    await a;
    await tick();
    expect(fetch.mock.calls[1]).toEqual([
      `/books/${id}`,
      { method: "DELETE", headers: { Accept: "application/json" }, retry: false },
    ]);
    expect(data(client).stars).toBe(8);
    remove.resolve({ success: true });
    await deletion;
    expect(data(client).status).toBeUndefined();
    expect(data(client).stars).toBeUndefined();
    expect(data(client).previousReads).toBeUndefined();
    expect(data(client).owned).toBe(false);
  });

  it("keeps confirmed state after delete failure and allows retry", async () => {
    const queue = createBookMutationQueue(client);
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ success: true, userBook: canonical({ stars: 8 }) })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    await queue.update({ hiveId: id, stars: 8 }, fetch);
    await expect(queue.remove(id, fetch)).rejects.toThrow();
    expect(data(client).stars).toBe(8);
    await queue.remove(id, fetch);
    expect(data(client).stars).toBeUndefined();
  });

  it("uses presence semantics for false/zero/empty edits and reconciles null clears", async () => {
    const queue = createBookMutationQueue(client);
    client.setQueryData(key, { ...data(client), review: "before" });
    const response = deferred<unknown>();
    const fetch = jest.fn().mockReturnValue(response.promise);
    const save = queue.update({ hiveId: id, owned: false, stars: 0, review: "" }, fetch);
    expect(data(client).owned).toBe(false);
    expect(data(client).stars).toBe(0);
    expect(data(client).review).toBe("");
    await tick();
    response.resolve({ success: true, userBook: canonical({ owned: false }) });
    await save;
    expect(data(client).stars).toBeUndefined();
    expect(data(client).review).toBeUndefined();
  });

  it("uses the shared reread transition and never retries a lost response", async () => {
    const queue = createBookMutationQueue(client);
    const before = {
      ...data(client),
      status: FINISHED,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-02T00:00:00.000Z",
    };
    client.setQueryData(key, before);
    const response = deferred<unknown>();
    const fetch = jest.fn().mockReturnValue(response.promise);
    const save = queue.update({ hiveId: id, status: READING }, fetch);
    const rejected = save.catch((error: unknown) => error);
    expect(data(client).status).toBe(READING);
    expect(data(client).finishedAt).toBeUndefined();
    expect(data(client).previousReads).toEqual([
      {
        startedAt: before.startedAt,
        finishedAt: before.finishedAt,
      },
    ]);
    await tick();
    response.reject(new Error("Response lost"));
    expect(await rejected).toEqual(new Error("Response lost"));
    expect(data(client)).toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].retry).toBe(false);
  });

  it("lets unrelated books run concurrently and delays invalidation until all queues drain", async () => {
    const queue = createBookMutationQueue(client);
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const otherId = "bk_other" as HiveId;
    const fetch = jest.fn((_url: string, options: { body: { hiveId: HiveId } }) =>
      options.body.hiveId === id ? first.promise : second.promise,
    );
    const a = queue.update({ hiveId: id, stars: 8 }, fetch as any);
    const b = queue.update({ hiveId: otherId, stars: 8 }, fetch as any);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    first.resolve({ success: true, userBook: canonical({ stars: 8 }) });
    await a;
    expect(invalidate).not.toHaveBeenCalled();
    second.resolve({ success: true, userBook: canonical({ hiveId: otherId, stars: 8 }) });
    await b;
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect cleared cache or dispatch queued writes after a session transition", async () => {
    let active = true;
    const queue = bookMutationQueue(client, () => active);
    // A second hook must share the original session fence as well as pending edits.
    expect(bookMutationQueue(client, () => true)).toBe(queue);
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const response = deferred<unknown>();
    const fetch = jest.fn().mockReturnValue(response.promise);
    const first = queue.update({ hiveId: id, stars: 8 }, fetch);
    const firstFailure = first.catch((error: unknown) => error);
    const second = queue.update({ hiveId: id, review: "queued" }, fetch);
    const secondFailure = second.catch((error: unknown) => error);
    await tick();
    active = false;
    client.clear();
    response.resolve({ success: true, userBook: canonical({ stars: 8 }) });
    expect(await firstFailure).toEqual(
      new Error("Authentication session changed; request cancelled"),
    );
    expect(await secondFailure).toEqual(
      new Error("Authentication session changed; request cancelled"),
    );
    expect(client.getQueryData(key)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    await expect(queue.update({ hiveId: id, stars: 4 }, fetch)).rejects.toThrow("session changed");
  });
});

it("requires explicit success for follow/unfollow as well as book writes", () => {
  for (const response of [undefined, {}, { success: false }, { success: "true" }]) {
    expect(() => requireMutationSuccess(response)).toThrow();
  }
  expect(() => requireMutationSuccess({ success: false, message: "PDS refused" })).toThrow(
    "PDS refused",
  );
  expect(requireMutationSuccess({ success: true })).toEqual({ success: true });
});
