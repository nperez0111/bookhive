/**
 * Client state for "my relationship to this book" on /books/:id, shared by
 * the three islands. Changes apply optimistically and roll back to
 * `confirmed` on failure. Writes are serialised because the server CASes
 * each one on the previous write's cid, so a response never overwrites
 * `view` while later writes are still queued.
 */
import type { UserBookView } from "../../../core/userBookView";
import { ABANDONED, FINISHED, READING, WANTTOREAD } from "../../../constants";
import { nextReadingState } from "../../../core/bookLifecycle";
import { deleteBook, writeBook } from "../bookApi";

/** The same four values the server writes, mirroring the table in `constants.ts`. */
export const STATUS = {
  FINISHED,
  READING,
  WANT_TO_READ: WANTTOREAD,
  ABANDONED,
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

function nowIso() {
  return new Date().toISOString();
}

/**
 * The optimistic paint. It runs the *same* transition the server will
 * (`core/bookLifecycle.ts`), so a divergence between the drawn frame and the
 * server's response can only come from `current` being stale, never from two
 * implementations of the rule.
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
  if (fields.bookProgress !== undefined) {
    next.bookProgress = fields.bookProgress
      ? { ...fields.bookProgress, updatedAt: nowIso() }
      : null;
  }

  const transition = nextReadingState(
    {
      status: base.status,
      startedAt: base.startedAt,
      finishedAt: base.finishedAt,
      previousReads: base.previousReads,
    },
    {
      status: fields.status,
      startedAt: fields.startedAt,
      finishedAt: fields.finishedAt,
      bookProgress: fields.bookProgress,
    },
    { now: nowIso },
  );
  next.status = transition.status;
  next.startedAt = transition.startedAt;
  next.finishedAt = transition.finishedAt;
  next.previousReads = transition.previousReads;

  if (next.status === STATUS.FINISHED && next.bookProgress) {
    next.bookProgress = {
      ...next.bookProgress,
      percent: 100,
      currentPage: next.bookProgress.totalPages ?? next.bookProgress.currentPage,
    };
  }

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
  // `updateBookRecord` creates a record when no row exists, so a write starting during the DELETE would put the book back — awaiting `queue` isn't enough since every `update` reassigns it.
  let deleting = false;

  async function send(fields: UpdateFields, explicitSave: boolean): Promise<boolean> {
    const result = await writeBook(props.hiveId, fields);
    if (result.ok && result.userBook) {
      const pending = state.pending - 1;
      set({
        confirmed: result.userBook,
        pending,
        view: pending === 0 ? result.userBook : state.view,
        savedAt: explicitSave ? Date.now() : state.savedAt,
      });
      return true;
    }
    // The server's message can name CIDs and lexicon paths.
    console.error("[book] save failed:", result.ok ? "Missing book" : result.message);
    set({
      pending: state.pending - 1,
      view: state.confirmed,
      error: "That change could not be saved. Your library was left as it was.",
    });
    return false;
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
      try {
        const result = await deleteBook(props.hiveId);
        if (!result.ok) throw new Error(result.message);
        set({ view: null, confirmed: null });
        return true;
      } catch (e) {
        console.error("[book] remove failed:", e);
        set({ error: "The book could not be removed. Please try again." });
        return false;
      } finally {
        deleting = false;
      }
    },
    dismissError: () => {
      set({ error: null });
    },
  };
}
