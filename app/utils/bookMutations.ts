import type { QueryClient } from "@tanstack/react-query";
import type { BookProgress, GetBook, HiveId } from "../../src/types";
import type { UserBookView } from "../../src/core/userBookView";
import { nextReadingState } from "../../src/core/bookLifecycle";
import { FINISHED } from "../../src/constants";

/** The JSON write contract, not the DB row (whose owned field is numeric). */
export type BookUpdateInput = {
  hiveId: HiveId;
  status?: string;
  owned?: boolean;
  stars?: number;
  review?: string;
  startedAt?: string;
  finishedAt?: string;
  bookProgress?: (Omit<BookProgress, "updatedAt"> & { updatedAt?: string }) | null;
};
type BookData = GetBook.$output;
type Fields = Omit<BookUpdateInput, "hiveId">;
type Fetch = <T>(url: string, options: Record<string, unknown>) => Promise<T>;

/** HTTP 2xx alone is not a confirmed PDS write. */
export function requireMutationSuccess<T>(body: T): T {
  if (!body || typeof body !== "object" || !("success" in body) || body.success !== true) {
    const message = body && typeof body === "object" && "message" in body ? body.message : null;
    throw new Error(typeof message === "string" ? message : "The change could not be saved.");
  }
  return body;
}

function isUserBookView(value: unknown, hiveId: HiveId): value is UserBookView {
  if (!value || typeof value !== "object") return false;
  const book = value as Record<string, unknown>;
  return (
    book.hiveId === hiveId &&
    ["uri", "cid", "title", "authors", "createdAt", "indexedAt"].every(
      (key) => typeof book[key] === "string",
    ) &&
    typeof book.owned === "boolean" &&
    ["status", "review", "startedAt", "finishedAt"].every(
      (key) => book[key] === null || typeof book[key] === "string",
    ) &&
    (book.stars === null || (typeof book.stars === "number" && Number.isFinite(book.stars))) &&
    (book.bookProgress === null ||
      (typeof book.bookProgress === "object" && !Array.isArray(book.bookProgress))) &&
    (book.previousReads === null || Array.isArray(book.previousReads))
  );
}

/** Replace *all* viewer fields, including server-cleared nulls; retain catalogue/comments. */
function reconcile(data: BookData | undefined, book: UserBookView | null): BookData | undefined {
  if (!data) return data;
  return {
    ...data,
    status: book?.status ?? undefined,
    owned: book?.owned ?? false,
    stars: book?.stars ?? undefined,
    review: book?.review ?? undefined,
    startedAt: book?.startedAt ?? undefined,
    finishedAt: book?.finishedAt ?? undefined,
    bookProgress: book?.bookProgress ?? undefined,
    previousReads: book?.previousReads ?? undefined,
    createdAt: book?.createdAt ?? undefined,
  };
}

function optimistic(data: BookData, fields: Fields, now: string): BookData {
  const transition = nextReadingState(
    {
      status: data.status ?? null,
      startedAt: data.startedAt ?? null,
      finishedAt: data.finishedAt ?? null,
      previousReads: data.previousReads ?? null,
    },
    {
      status: fields.status ?? undefined,
      startedAt: fields.startedAt ?? undefined,
      finishedAt: fields.finishedAt ?? undefined,
      bookProgress: fields.bookProgress,
    },
    { now: () => now },
  );
  let bookProgress =
    fields.bookProgress === undefined
      ? data.bookProgress
      : fields.bookProgress
        ? { ...fields.bookProgress, updatedAt: now }
        : null;
  if (bookProgress && transition.status === FINISHED) {
    bookProgress = {
      ...bookProgress,
      percent: 100,
      currentPage: bookProgress.totalPages ?? bookProgress.currentPage,
    };
  }
  return {
    ...data,
    status: transition.status ?? undefined,
    startedAt: transition.startedAt ?? undefined,
    finishedAt: transition.finishedAt ?? undefined,
    previousReads: transition.previousReads ?? undefined,
    owned: fields.owned === undefined ? data.owned : Boolean(fields.owned),
    stars: fields.stars === undefined ? data.stars : (fields.stars ?? undefined),
    review: fields.review === undefined ? data.review : (fields.review ?? undefined),
    bookProgress: bookProgress ?? undefined,
  };
}

type Operation = {
  fields?: Fields;
  now: string;
  send: () => Promise<UserBookView | null>;
  resolve: (result: { success: true; userBook: UserBookView | null }) => void;
  reject: (error: unknown) => void;
};
type Entry = { confirmed: BookData | undefined; pending: Operation[]; running: boolean };

/** Root SessionCache creates a new client per epoch, including logout → same-account login. */
const coordinators = new WeakMap<QueryClient, ReturnType<typeof createBookMutationQueue>>();
export function bookMutationQueue(client: QueryClient, isCurrent = () => true) {
  let queue = coordinators.get(client);
  if (!queue) coordinators.set(client, (queue = createBookMutationQueue(client, isCurrent)));
  return queue;
}

export function createBookMutationQueue(client: QueryClient, isCurrent = () => true) {
  const entries = new Map<HiveId, Entry>();
  const publish = (id: HiveId, entry: Entry) => {
    if (!isCurrent()) return;
    const view = entry.pending.reduce(
      (data, op) => (data && op.fields ? optimistic(data, op.fields, op.now) : data),
      entry.confirmed,
    );
    if (view) client.setQueryData(["getBook", id], view);
  };
  const run = async (id: HiveId, entry: Entry) => {
    if (entry.running) return;
    entry.running = true;
    while (entry.pending.length) {
      const op = entry.pending[0]!;
      let result: UserBookView | null = null;
      let failure: unknown;
      try {
        if (!isCurrent()) throw new Error("Authentication session changed; request cancelled");
        await client.cancelQueries({ queryKey: ["getBook", id] });
        publish(id, entry);
        result = await op.send();
        if (!isCurrent()) throw new Error("Authentication session changed; request cancelled");
        entry.confirmed = reconcile(entry.confirmed, result);
      } catch (error) {
        failure = error;
      }
      entry.pending.shift();
      // Drop only this edit; rebase later edits on the last confirmed server state.
      publish(id, entry);
      if (failure) op.reject(failure);
      else op.resolve({ success: true, userBook: result });
    }
    entries.delete(id);
    // Refresh shared views only once every pending book has settled.
    if (!entries.size && isCurrent()) {
      void client.invalidateQueries({ queryKey: ["profile"] });
      void client.invalidateQueries({ queryKey: ["getBook"] });
    }
  };
  const enqueue = (id: HiveId, send: Operation["send"], fields?: Fields) => {
    if (!isCurrent()) {
      return Promise.reject(new Error("Authentication session changed; request cancelled"));
    }
    let entry = entries.get(id);
    if (entry?.pending.some((op) => !op.fields)) {
      return Promise.reject(new Error("This book is being removed. Wait before editing it."));
    }
    // Cancellation reverts an active refetch synchronously, before we capture confirmed state.
    void client.cancelQueries({ queryKey: ["getBook", id] });
    if (!entry) {
      entry = { confirmed: client.getQueryData(["getBook", id]), pending: [], running: false };
      entries.set(id, entry);
    }
    const promise = new Promise<{ success: true; userBook: UserBookView | null }>(
      (resolve, reject) => {
        entry.pending.push({ fields, send, resolve, reject, now: new Date().toISOString() });
      },
    );
    publish(id, entry);
    void run(id, entry);
    return promise;
  };
  return {
    update: ({ hiveId, ...fields }: BookUpdateInput, fetch: Fetch) =>
      enqueue(
        hiveId,
        async () => {
          const body = requireMutationSuccess(
            await fetch<{ success: boolean; userBook?: unknown }>("/api/update-book", {
              method: "POST",
              body: { hiveId, ...fields },
              retry: false,
            }),
          );
          if (!isUserBookView(body.userBook, hiveId)) {
            throw new Error(
              "The server did not confirm the saved book. Please refresh before retrying.",
            );
          }
          return body.userBook;
        },
        fields,
      ),
    remove: (hiveId: HiveId, fetch: Fetch) =>
      enqueue(hiveId, async () => {
        requireMutationSuccess(
          await fetch(`/books/${hiveId}`, {
            method: "DELETE",
            headers: { Accept: "application/json" },
            retry: false,
          }),
        );
        return null;
      }),
  };
}
