/**
 * Client state for "my relationship to this book" on /books/:id, shared by the
 * three islands. Changes apply optimistically and are replaced by the server's
 * `UserBookView`; on failure `view` snaps back to `confirmed`.
 *
 * Writes are serialised because the server CASes each one on the previous
 * write's cid, and a response never overwrites `view` while later writes are
 * still queued — it would undo what the user just did.
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

/** Mirrors the server's `dateInputToISO`. */
function dateInputToIso(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  // An emptied box is a no-op server-side, not a clear.
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

/** Mirrors the server's `inferBookStatusAndDates`; its answer always wins. */
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

  // `sent` is the status this payload asserts. A payload asserting none leaves
  // the server's status and dates untouched, so guessing here paints a frame
  // the response would take back.
  let sent = fields.status;
  if (fields.bookProgress !== undefined && !sent) {
    next.bookProgress = fields.bookProgress
      ? { ...fields.bookProgress, updatedAt: nowIso() }
      : null;
    // `/api/update-book` stamps READING onto a statusless progress write.
    sent = STATUS.READING;
  } else if (fields.bookProgress !== undefined) {
    next.bookProgress = fields.bookProgress
      ? { ...fields.bookProgress, updatedAt: nowIso() }
      : null;
  }
  const currentStatus = fields.status ?? base.status;
  if (startedAt && (!currentStatus || currentStatus === STATUS.WANT_TO_READ)) {
    sent = STATUS.READING;
  }
  if (
    finishedAt &&
    (!currentStatus || currentStatus === STATUS.WANT_TO_READ || currentStatus === STATUS.READING)
  ) {
    sent = STATUS.FINISHED;
  }
  const status = sent ?? base.status;

  const isReread = fields.status === STATUS.READING && base.status === STATUS.FINISHED;
  // Only a real transition stamps a date, matching the server.
  const alreadyReading = base.status === STATUS.READING && !!base.startedAt;
  const alreadyFinished = base.status === STATUS.FINISHED && !!base.finishedAt;
  if (isReread) {
    if (base.finishedAt) {
      next.previousReads = [
        { startedAt: base.startedAt ?? undefined, finishedAt: base.finishedAt },
        ...(base.previousReads ?? []),
      ];
    }
    next.startedAt = nowIso();
    next.finishedAt = null;
  } else if (sent === STATUS.READING && !fields.startedAt && !alreadyReading) {
    next.startedAt = nowIso();
  } else if (sent === STATUS.FINISHED && !fields.finishedAt && !alreadyFinished) {
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
  // `updateBookRecord` creates a record when no row exists, so a write starting
  // during the DELETE would put the book back. Awaiting `queue` is not enough:
  // every `update` reassigns it. Cleared on settle, so re-adding still works.
  let deleting = false;

  async function send(fields: UpdateFields, explicitSave: boolean): Promise<boolean> {
    // A request the browser never times out would wedge the queue.
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
      // The server's message names CIDs and lexicon paths.
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
