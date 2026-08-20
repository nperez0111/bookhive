/**
 * Client state for "my relationship to this book" on /books/:id.
 *
 * One store per page, shared by the islands in the hero card and the
 * activity card. Every change is applied to `view` at once, then sent; the
 * server's `UserBookView` replaces `view` when it lands, which is how
 * server-side inference (auto dates, re-read rotation, 100% on finish) shows
 * up without a reload. On failure `view` snaps back to `confirmed`.
 *
 * Mutations are serialised: the server holds a per-user lock and the merge
 * is CAS'd on the previous write's cid, so two in-flight writes would only
 * race each other. While later writes are still queued a response does not
 * overwrite `view` — it would briefly undo what the user just did.
 */
import type { UserBookView } from "../../../utils/userBookView";

export const STATUS = {
  FINISHED: "buzz.bookhive.defs#finished",
  READING: "buzz.bookhive.defs#reading",
  WANT_TO_READ: "buzz.bookhive.defs#wantToRead",
  ABANDONED: "buzz.bookhive.defs#abandoned",
} as const;

export type BookProgressFields = {
  percent?: number;
  totalPages?: number;
  currentPage?: number;
  totalChapters?: number;
  currentChapter?: number;
};

/** What `/api/update-book` accepts, minus `hiveId`. */
export type UpdateFields = {
  status?: string;
  owned?: boolean;
  stars?: number;
  review?: string;
  /** YYYY-MM-DD or "" to clear. */
  startedAt?: string;
  finishedAt?: string;
  bookProgress?: BookProgressFields | null;
};

export type BookActionsProps = {
  hiveId: string;
  title: string;
  authors: string;
  numPages: number | null;
  userBook: UserBookView | null;
};

export type StoreState = {
  view: UserBookView | null;
  confirmed: UserBookView | null;
  pending: number;
  error: string | null;
  /** Set briefly after a successful explicit Save. */
  savedAt: number | null;
};

export type UserBookStore = ReturnType<typeof createUserBookStore>;

/** Bounds how long one mutation can hold the queue. */
const REQUEST_TIMEOUT_MS = 20_000;

function nowIso() {
  return new Date().toISOString();
}

/** Mirrors `dateInputToISO` on the server: a date input's value plus the current time of day. */
function dateInputToIso(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  // The server's `normalizeDate("")` yields undefined and the merge then keeps
  // the recorded date, so an emptied box is a no-op, not a clear. Mirroring
  // that here is what stops the UI from showing a clear that never happened.
  if (value === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const now = new Date();
    return new Date(
      Date.UTC(y, m - 1, d, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()),
    ).toISOString();
  }
  return value;
}

/**
 * The server's `inferBookStatusAndDates` + re-read rules, approximated so the
 * optimistic frame looks like the confirmed one will. The server's answer
 * always wins.
 */
export function applyOptimistic(
  current: UserBookView | null,
  fields: UpdateFields,
  props: Pick<BookActionsProps, "hiveId" | "title" | "authors">,
): UserBookView {
  const base: UserBookView = current ?? {
    uri: "",
    cid: "",
    hiveId: props.hiveId as UserBookView["hiveId"],
    title: props.title,
    authors: props.authors,
    status: null,
    owned: true,
    stars: null,
    review: null,
    startedAt: null,
    finishedAt: null,
    bookProgress: null,
    previousReads: null,
    createdAt: nowIso(),
    indexedAt: nowIso(),
  };
  const next: UserBookView = { ...base };

  if (fields.owned !== undefined) next.owned = fields.owned;
  if (fields.stars !== undefined) next.stars = fields.stars || null;
  if (fields.review !== undefined) next.review = fields.review || base.review;

  const startedAt = dateInputToIso(fields.startedAt);
  const finishedAt = dateInputToIso(fields.finishedAt);
  if (startedAt !== undefined) next.startedAt = startedAt;
  if (finishedAt !== undefined) next.finishedAt = finishedAt;

  let status = fields.status ?? base.status;
  if (fields.bookProgress !== undefined) {
    next.bookProgress = fields.bookProgress
      ? { ...fields.bookProgress, updatedAt: nowIso() }
      : null;
    // `/api/update-book` forces READING on any progress write that carries no
    // status of its own — including on an abandoned book.
    if (!fields.status) status = STATUS.READING;
  }
  if (startedAt && (!status || status === STATUS.WANT_TO_READ)) status = STATUS.READING;
  if (finishedAt && (!status || status === STATUS.WANT_TO_READ || status === STATUS.READING)) {
    status = STATUS.FINISHED;
  }

  const isReread = fields.status === STATUS.READING && base.status === STATUS.FINISHED;
  if (isReread) {
    if (base.finishedAt) {
      next.previousReads = [
        { startedAt: base.startedAt ?? undefined, finishedAt: base.finishedAt },
        ...(base.previousReads ?? []),
      ];
    }
    next.startedAt = nowIso();
    next.finishedAt = null;
  } else if (status === STATUS.READING && !next.startedAt) {
    next.startedAt = nowIso();
  } else if (status === STATUS.FINISHED && !next.finishedAt) {
    next.finishedAt = nowIso();
  }

  if (status === STATUS.FINISHED && next.bookProgress) {
    next.bookProgress = {
      ...next.bookProgress,
      percent: 100,
      currentPage: next.bookProgress.totalPages ?? next.bookProgress.currentPage,
    };
  }

  next.status = status ?? null;
  return next;
}

export function createUserBookStore(props: BookActionsProps) {
  let state: StoreState = {
    view: props.userBook,
    confirmed: props.userBook,
    pending: 0,
    error: null,
    savedAt: null,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<StoreState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  let queue: Promise<unknown> = Promise.resolve();
  // Set synchronously for the whole removal, because `updateBookRecord`
  // *creates* a record when no `user_book` row exists: a write that starts
  // during the DELETE would put the book back on the user's PDS. Awaiting the
  // queue is not enough — `queue` is reassigned by every `update`, so a click
  // during the round trip would slip past it. Cleared when the removal
  // settles, so re-adding the book afterwards still works.
  let deleting = false;

  async function send(fields: UpdateFields, explicitSave: boolean): Promise<boolean> {
    // Everything runs through one queue and `pending` only drops when a send
    // settles, so a request the browser never times out would wedge the Save
    // button and block every later change on the page.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/update-book", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ hiveId: props.hiveId, ...fields }),
        signal: abort.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        userBook?: UserBookView;
      };
      if (!res.ok || !body.success || !body.userBook) {
        throw new Error(body.message || `Could not save (${res.status})`);
      }
      const pending = state.pending - 1;
      set({
        confirmed: body.userBook,
        pending,
        view: pending === 0 ? body.userBook : state.view,
        savedAt: explicitSave ? Date.now() : state.savedAt,
      });
      return true;
    } catch (e) {
      // The server's message names CIDs and lexicon paths; that belongs in
      // the console, not next to the button.
      console.error("[book] save failed:", e);
      set({
        pending: state.pending - 1,
        view: state.confirmed,
        error: "That change could not be saved. Your library was left as it was.",
      });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    /** Apply at once, send in order. Resolves to whether the write landed. */
    update: (fields: UpdateFields, { explicitSave = false } = {}): Promise<boolean> => {
      if (deleting) return Promise.resolve(false);
      set({
        view: applyOptimistic(state.view, fields, props),
        pending: state.pending + 1,
        error: null,
      });
      const run = () => send(fields, explicitSave);
      queue = queue.then(run, run);
      return queue as Promise<boolean>;
    },
    remove: async (): Promise<boolean> => {
      if (deleting) return false;
      deleting = true;
      set({ error: null });
      // Queued writes first: a delete that overtakes them would be undone by
      // whichever one lands last.
      await queue.catch(() => {});
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`/books/${props.hiveId}`, {
          method: "DELETE",
          headers: { accept: "application/json" },
          signal: abort.signal,
        });
        const body = (await res.json().catch(() => ({}))) as { success?: boolean };
        if (!res.ok || !body.success) throw new Error(`Could not remove (${res.status})`);
        set({ view: null, confirmed: null });
        return true;
      } catch (e) {
        console.error("[book] remove failed:", e);
        set({ error: "The book could not be removed. Please try again." });
        return false;
      } finally {
        clearTimeout(timer);
        deleting = false;
      }
    },
    dismissError: () => {
      set({ error: null });
    },
  };
}
