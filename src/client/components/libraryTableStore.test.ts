import { expect, test } from "bun:test";
import { createLibraryTableStore } from "./libraryTableStore";
import type { LibraryBook } from "./LibraryTable";
import type { BookWriteResult } from "./bookApi";
import type { UserBookView } from "../../core/userBookView";

const book: LibraryBook = {
  hiveId: "bk_fixture",
  title: "Fixture",
  authors: "Author",
  status: "wantToRead",
  stars: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  owned: 0,
  review: null,
  bookProgress: { currentPage: 66, totalPages: 658 },
  totalPages: 658,
};
function success(fields: Partial<UserBookView> = {}): BookWriteResult {
  return {
    ok: true,
    userBook: {
      ...book,
      hiveId: "bk_fixture",
      uri: "at://fixture/book/1",
      cid: "cid",
      owned: false,
      bookProgress: null,
      previousReads: null,
      indexedAt: book.createdAt,
      ...fields,
    },
  };
}
const failure: BookWriteResult = { ok: false, status: 500, message: "Save failed" };
function deferred() {
  let resolve!: (value: BookWriteResult) => void;
  const promise = new Promise<BookWriteResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("successful writes reconcile inferred status, dates and progress from server", async () => {
  const store = createLibraryTableStore([book], () => {}, {
    write: async () =>
      success({
        status: "reading",
        startedAt: "2026-09-14T00:00:00Z",
        bookProgress: {
          currentPage: 66,
          totalPages: 658,
          percent: 10,
          updatedAt: "2026-09-14T00:00:00Z",
        },
      }),
    remove: async () => ({ ok: true, userBook: null }),
  });
  await store.save(book.hiveId, { bookProgress: { currentPage: 66, totalPages: 658 } });
  expect(store.snapshot()[0]?.status).toBe("reading");
  expect(store.snapshot()[0]?.startedAt).toBe("2026-09-14T00:00:00Z");
  expect(store.snapshot()[0]?.bookProgress?.percent).toBe(10);
});

test("queued later progress survives first response; failed later save restores last confirmation", async () => {
  const first = deferred();
  const second = deferred();
  const calls: Record<string, unknown>[] = [];
  const store = createLibraryTableStore([book], () => {}, {
    write: (_id, fields) => {
      calls.push(fields);
      return calls.length === 1 ? first.promise : second.promise;
    },
    remove: async () => ({ ok: true, userBook: null }),
  });
  const one = store.save(book.hiveId, { bookProgress: { currentPage: 100 } });
  const two = store.save(book.hiveId, { bookProgress: { currentPage: 200 } });
  expect(calls).toHaveLength(1);
  first.resolve(
    success({ status: "reading", bookProgress: { currentPage: 100, updatedAt: book.createdAt } }),
  );
  await one;
  expect(calls).toHaveLength(2);
  expect(store.snapshot()[0]?.bookProgress?.currentPage).toBe(200);
  expect(store.snapshot()[0]?.status).toBe("reading");
  second.resolve(failure);
  await two;
  expect(store.snapshot()[0]?.bookProgress?.currentPage).toBe(100);
});

test("failed earlier edit cannot roll back a later successful edit", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const store = createLibraryTableStore([book], () => {}, {
    write: () => (++calls === 1 ? first.promise : second.promise),
    remove: async () => ({ ok: true, userBook: null }),
  });
  const one = store.save(book.hiveId, { stars: 2 });
  const two = store.save(book.hiveId, { stars: 8 });
  first.resolve(failure);
  await one;
  expect(store.snapshot()[0]?.stars).toBe(8);
  second.resolve(success({ stars: 8 }));
  await two;
  expect(store.snapshot()[0]?.stars).toBe(8);
});

test("delete waits for save and rejects new edits; failed delete restores newest confirmed row", async () => {
  const pending = deferred();
  let deletes = 0;
  let writes = 0;
  const store = createLibraryTableStore([book], () => {}, {
    write: () => {
      writes++;
      return pending.promise;
    },
    remove: async () => {
      deletes++;
      return failure;
    },
  });
  const one = store.save(book.hiveId, { stars: 8 });
  const removal = store.remove(book.hiveId);
  expect(await store.save(book.hiveId, { stars: 2 })).toBe(false);
  expect(writes).toBe(1);
  expect(deletes).toBe(0);
  expect(store.snapshot()[0]?.stars).toBe(8);
  pending.resolve(success({ stars: 8 }));
  expect(await one).toBe(true);
  expect(await removal).toBe(false);
  expect(deletes).toBe(1);
  expect(store.snapshot()[0]?.stars).toBe(8);
});
