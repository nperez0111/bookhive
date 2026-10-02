import type { LibraryBook } from "./LibraryTable";
import { deleteBook, writeBook, type BookWriteResult } from "./bookApi";

type Operation = {
  fields?: Partial<LibraryBook>;
  payload?: Record<string, unknown>;
  done: (ok: boolean) => void;
};
type Entry = { confirmed: LibraryBook; pending: Operation[]; running: boolean };

/** Per-book serialization: reconcile confirmed state, then replay only later edits. */
export function createLibraryTableStore(
  initial: LibraryBook[],
  onChange: (books: LibraryBook[], error: string | null) => void,
  transport: {
    write: (id: string, fields: Record<string, unknown>) => Promise<BookWriteResult>;
    remove: (id: string) => Promise<BookWriteResult>;
  } = { write: writeBook, remove: deleteBook },
) {
  const entries = new Map(
    initial.map((book) => [book.hiveId, { confirmed: book, pending: [], running: false } as Entry]),
  );
  let error: string | null = null;
  const snapshot = () =>
    [...entries.values()].map(({ confirmed, pending }) =>
      pending.reduce(
        (book, operation) => (operation.fields ? { ...book, ...operation.fields } : book),
        confirmed,
      ),
    );
  const publish = () => onChange(snapshot(), error);
  const run = async (id: string, entry: Entry) => {
    if (entry.running) return;
    entry.running = true;
    while (entry.pending.length) {
      const operation = entry.pending[0]!;
      let result: BookWriteResult;
      try {
        result = operation.fields
          ? await transport.write(id, operation.payload ?? operation.fields)
          : await transport.remove(id);
      } catch {
        result = { ok: false, status: 0, message: "The change could not be sent." };
      }
      if (result.ok) {
        if (!operation.fields) {
          entries.delete(id);
        } else if (result.userBook) {
          entry.confirmed = {
            ...entry.confirmed,
            ...result.userBook,
            owned: Number(result.userBook.owned),
          };
        } else {
          entry.confirmed = { ...entry.confirmed, ...operation.fields };
        }
      } else {
        error = operation.fields
          ? `${result.message} The unsaved change was reverted.`
          : "That book could not be removed. Please try again.";
      }
      entry.pending.shift();
      publish();
      operation.done(result.ok);
    }
    entry.running = false;
  };
  const enqueue = (
    id: string,
    fields?: Partial<LibraryBook>,
    payload?: Record<string, unknown>,
  ): Promise<boolean> => {
    const entry = entries.get(id);
    // Once deletion is requested, further edits cannot recreate the removed record.
    if (!entry || entry.pending.some((operation) => !operation.fields))
      return Promise.resolve(false);
    error = null;
    const promise = new Promise<boolean>((done) => entry.pending.push({ fields, payload, done }));
    publish();
    void run(id, entry);
    return promise;
  };
  return {
    snapshot,
    save: (id: string, fields: Partial<LibraryBook>, payload?: Record<string, unknown>) =>
      enqueue(id, fields, payload),
    remove: (id: string) => enqueue(id),
  };
}
