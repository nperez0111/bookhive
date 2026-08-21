import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState, type FC } from "hono/jsx/dom";

import type { UserBookView } from "../../../utils/userBookView";
import { StarRating } from "../StarRating";
import { useUserBook } from "./BookActionRow";
import {
  STATUS,
  type BookActionsProps,
  type UpdateFields,
  type UserBookStore,
} from "./userBookStore";

type Draft = {
  review: string;
  currentPage: string;
  totalPages: string;
  currentChapter: string;
  totalChapters: string;
  percent: string;
  startedAt: string;
  finishedAt: string;
};

const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function draftFrom(view: UserBookView | null, numPages: number | null): Draft {
  const p = view?.bookProgress;
  return {
    review: view?.review ?? "",
    currentPage: str(p?.currentPage),
    totalPages: str(p?.totalPages ?? numPages),
    currentChapter: str(p?.currentChapter),
    totalChapters: str(p?.totalChapters),
    percent: str(p?.percent),
    startedAt: toDateInput(view?.startedAt),
    finishedAt: toDateInput(view?.finishedAt),
  };
}

const num = (s: string) => {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Same rule the old inline script used: pages win, then chapters. */
function derivedPercent(d: Draft): number | null {
  const cp = num(d.currentPage);
  const tp = num(d.totalPages);
  const cc = num(d.currentChapter);
  const tc = num(d.totalChapters);
  if (cp !== undefined && tp && tp > 0)
    return Math.min(100, Math.max(0, Math.round((cp / tp) * 100)));
  if (cc !== undefined && tc && tc > 0)
    return Math.min(100, Math.max(0, Math.round((cc / tc) * 100)));
  return null;
}

const inputClass = "input focus-ring w-20 px-2 py-1.5 text-sm";
const dateClass =
  "rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none";

/** The line under the action buttons: the save error, if any, then "Finished: 2 days ago". */
export const BookUserTimestamp: FC<{ store: UserBookStore }> = ({ store }) => {
  const { view, error } = useUserBook(store);
  const when = view ? (view.finishedAt ?? view.startedAt ?? view.createdAt) : null;
  const label = view?.finishedAt ? "Finished" : view?.startedAt ? "Started" : "Added";
  return (
    <>
      {error && (
        <p role="alert" class="mb-3 flex items-center gap-3 text-sm text-destructive">
          <span style={{ textWrap: "pretty" }}>{error}</span>
          <button
            type="button"
            class="cursor-pointer underline underline-offset-2 hover:no-underline"
            onClick={() => store.dismissError()}
          >
            Dismiss
          </button>
        </p>
      )}
      {when && (
        <p class="mb-4 text-sm text-muted-foreground">
          {`${label}: ${formatDistanceToNow(new Date(when), { addSuffix: true })}`}
        </p>
      )}
    </>
  );
};

export const BookActivityPanel: FC<{ store: UserBookStore; props: BookActionsProps }> = ({
  store,
  props,
}) => {
  const { view, confirmed, pending, savedAt } = useUserBook(store);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(view, props.numPages));
  // Edited-since-save fields. Everything else follows the server, so a status
  // click's new date appears without wiping a half-written review.
  const [touched, setTouched] = useState<Set<keyof Draft>>(() => new Set());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [removing, setRemoving] = useState(false);
  /** Latest draft, for callbacks that must not close over a stale render. */
  const draftRef = useRef<Draft>(draft);
  draftRef.current = draft;
  const lastConfirmedCid = useRef(confirmed?.cid ?? null);

  useEffect(() => {
    const cid = confirmed?.cid ?? null;
    if (cid === lastConfirmedCid.current) return;
    lastConfirmedCid.current = cid;
    const fresh = draftFrom(confirmed, props.numPages);
    setDraft((d) => {
      const next = { ...fresh };
      for (const key of touched) next[key] = d[key];
      return next;
    });
  }, [confirmed?.cid]);

  const edit = (key: keyof Draft, value: string) => {
    setTouched((t) => new Set(t).add(key));
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key !== "percent" && key !== "review" && key !== "startedAt" && key !== "finishedAt") {
        const pct = derivedPercent(next);
        if (pct !== null) next.percent = String(pct);
      }
      return next;
    });
  };

  const finished = view?.status === STATUS.FINISHED;
  const livePercent = finished ? 100 : (num(draft.percent) ?? view?.bookProgress?.percent ?? null);

  const onSave = (e: Event) => {
    e.preventDefault();
    const fields: UpdateFields = {};
    if (touched.has("review")) fields.review = draft.review;
    if (touched.has("startedAt")) fields.startedAt = draft.startedAt;
    if (touched.has("finishedAt")) fields.finishedAt = draft.finishedAt;
    const progressTouched = (
      ["currentPage", "totalPages", "currentChapter", "totalChapters", "percent"] as const
    ).some((k) => touched.has(k));
    if (!finished && progressTouched) {
      const progress = {
        currentPage: num(draft.currentPage),
        totalPages: num(draft.totalPages),
        currentChapter: num(draft.currentChapter),
        totalChapters: num(draft.totalChapters),
        percent: num(draft.percent),
      };
      if (Object.values(progress).some((v) => v !== undefined)) fields.bookProgress = progress;
    }
    if (Object.keys(fields).length === 0 && view) return;
    // `touched` clears only once the write lands: clearing up front left a
    // failed save showing the user's text with a Save button that did nothing.
    const sent = new Set(touched);
    const sentValues = { ...draft };
    void store.update(fields, { explicitSave: true }).then((ok) => {
      if (!ok) return;
      // Re-sync sent fields from what was actually stored — an emptied review
      // or date is not a clear. A field edited again mid-flight keeps its new
      // text *and* its dirty flag, or that text becomes unsaveable.
      const confirmedNow = store.getSnapshot().confirmed;
      const fresh = draftFrom(confirmedNow, props.numPages);
      const stillAsSent = (key: keyof Draft) =>
        (draftRef.current ?? draft)[key] === sentValues[key];
      setTouched((t) => {
        const next = new Set(t);
        for (const key of sent) if (stillAsSent(key)) next.delete(key);
        return next;
      });
      setDraft((d) => {
        const next = { ...d };
        for (const key of sent) {
          if (d[key] === sentValues[key]) next[key] = fresh[key];
        }
        return next;
      });
    });
  };

  const justSaved = savedAt !== null && Date.now() - savedAt < 2500;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => tick((n) => n + 1), 2500);
    return () => clearTimeout(t);
  }, [savedAt]);

  const previousReads = view?.previousReads ?? [];

  return (
    <div class="card-body space-y-6">
      <h2 class="card-title">Your Activity</h2>

      <form onSubmit={onSave}>
        <div class="space-y-6">
          <div>
            <label class="mb-2 block text-sm font-semibold text-foreground">Your Rating</label>
            <div class="flex cursor-pointer">
              <StarRating
                initialRating={view?.stars ?? 0}
                onChange={(stars) => {
                  // The server reads 0 as "leave the rating alone".
                  if (!stars) return;
                  void store.update({ stars });
                }}
              />
            </div>
          </div>

          <div>
            <label class="mb-2 block text-sm font-semibold text-foreground" htmlFor="review-input">
              {view?.review ? "Your Review" : "Write a Review"}
            </label>
            <div class="grid">
              <textarea
                id="review-input"
                class="col-start-1 row-start-1 min-h-[100px] w-full overflow-hidden rounded-md border-0 bg-card py-2 text-foreground shadow-xs ring-1 ring-border ring-inset placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:ring-inset sm:text-sm"
                style={{ resize: "none", gridArea: "1 / 1 / 2 / 2" }}
                placeholder="What did you think of this book?"
                name="review"
                value={draft.review}
                onInput={(e) => edit("review", (e.target as HTMLTextAreaElement).value)}
              />
              <div
                class="invisible col-start-1 row-start-1 overflow-hidden px-3 py-2 break-words whitespace-pre-wrap"
                aria-hidden="true"
              >
                {draft.review || " "}
              </div>
            </div>
          </div>

          <div>
            <label class="mb-2 block text-sm font-semibold text-foreground">Reading Progress</label>
            {finished ? (
              <>
                <div class="mb-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full bg-green-500 transition-[width] duration-300"
                    style="width: 100%"
                  />
                </div>
                <p class="text-sm text-muted-foreground">
                  <span class="font-medium text-green-600 dark:text-green-400">Finished!</span>
                  {(() => {
                    const pages = view?.bookProgress?.totalPages ?? props.numPages;
                    const chapters = view?.bookProgress?.totalChapters;
                    return (
                      <>
                        {pages && <span class="ml-1">{pages} pages read</span>}
                        {pages && chapters && <span> · </span>}
                        {chapters && <span>{chapters} chapters</span>}
                      </>
                    );
                  })()}
                </p>
              </>
            ) : (
              <>
                {!!livePercent && (
                  <div class="mb-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={`width: ${livePercent}%`}
                    />
                  </div>
                )}
                <div class="flex items-center gap-2">
                  <label class="text-sm text-muted-foreground" htmlFor="progress-current-page">
                    Page
                  </label>
                  <input
                    id="progress-current-page"
                    type="number"
                    min={1}
                    class={inputClass}
                    placeholder="0"
                    value={draft.currentPage}
                    onInput={(e) => edit("currentPage", (e.target as HTMLInputElement).value)}
                  />
                  <span class="text-muted-foreground">/</span>
                  <input
                    id="progress-total-pages"
                    aria-label="Total pages"
                    type="number"
                    min={1}
                    class={inputClass}
                    placeholder="Total"
                    value={draft.totalPages}
                    onInput={(e) => edit("totalPages", (e.target as HTMLInputElement).value)}
                  />
                </div>
                <details class="mt-3">
                  <summary class="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    More options (chapters, manual %)
                  </summary>
                  <div class="mt-3 space-y-3">
                    <div class="flex items-center gap-2">
                      <label
                        class="text-sm text-muted-foreground"
                        htmlFor="progress-current-chapter"
                      >
                        Chapter
                      </label>
                      <input
                        id="progress-current-chapter"
                        type="number"
                        min={1}
                        class={inputClass}
                        placeholder="0"
                        value={draft.currentChapter}
                        onInput={(e) =>
                          edit("currentChapter", (e.target as HTMLInputElement).value)
                        }
                      />
                      <span class="text-muted-foreground">/</span>
                      <input
                        id="progress-total-chapters"
                        aria-label="Total chapters"
                        type="number"
                        min={1}
                        class={inputClass}
                        placeholder="Total"
                        value={draft.totalChapters}
                        onInput={(e) => edit("totalChapters", (e.target as HTMLInputElement).value)}
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <label class="text-sm text-muted-foreground" htmlFor="progress-percent">
                        Percent
                      </label>
                      <input
                        id="progress-percent"
                        type="number"
                        min={0}
                        max={100}
                        class={inputClass}
                        placeholder="Auto"
                        value={draft.percent}
                        onInput={(e) => edit("percent", (e.target as HTMLInputElement).value)}
                      />
                      <span class="text-xs text-muted-foreground">
                        Auto-fills from pages or chapters
                      </span>
                    </div>
                  </div>
                </details>
              </>
            )}
          </div>

          {view && (
            <div>
              <label class="mb-2 block text-sm font-semibold text-foreground">Reading Dates</label>
              <div class="flex flex-wrap items-center gap-4">
                <div class="flex items-center gap-2">
                  <label class="text-sm text-muted-foreground" htmlFor="reading-started-at">
                    Started
                  </label>
                  <input
                    id="reading-started-at"
                    type="date"
                    class={dateClass}
                    value={draft.startedAt}
                    onInput={(e) => edit("startedAt", (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div class="flex items-center gap-2">
                  <label class="text-sm text-muted-foreground" htmlFor="reading-finished-at">
                    Finished
                  </label>
                  <input
                    id="reading-finished-at"
                    type="date"
                    class={dateClass}
                    value={draft.finishedAt}
                    onInput={(e) => edit("finishedAt", (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="btn btn-primary w-full transition-[scale] duration-150 active:scale-[0.96] sm:w-auto"
              aria-busy={pending > 0 ? "true" : "false"}
            >
              {pending > 0 ? "Saving…" : "Save"}
            </button>
            <span
              class={`text-sm text-muted-foreground transition-opacity duration-300 ${justSaved ? "opacity-100" : "opacity-0"}`}
              aria-live="polite"
            >
              Saved
            </span>
          </div>
        </div>
      </form>

      {previousReads.length > 0 && (
        <div>
          <p class="mb-2 block text-sm font-semibold text-foreground">Previously Read</p>
          <ul class="space-y-3 text-sm text-muted-foreground">
            {[...previousReads]
              .sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime())
              .map((r, i) => {
                const fin = new Date(r.finishedAt);
                const start = r.startedAt ? new Date(r.startedAt) : null;
                return (
                  <li key={`${r.finishedAt}-${i}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                    <span class="text-foreground">
                      {start
                        ? `${format(start, "MMM d, yyyy")} – ${format(fin, "MMM d, yyyy")}`
                        : format(fin, "MMM d, yyyy")}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {view && (
        <div class="border-t border-border pt-4">
          <button
            type="button"
            class="min-h-10 inline-flex items-center cursor-pointer text-xs text-muted-foreground hover:text-destructive"
            onClick={() => dialogRef.current?.showModal()}
          >
            Remove from library
          </button>
          <dialog
            ref={dialogRef}
            class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
          >
            <h3 class="mb-2 text-lg font-semibold">Remove book?</h3>
            <p class="mb-4 text-sm text-muted-foreground" style={{ textWrap: "pretty" }}>
              This will remove "{props.title}" from your library. This cannot be undone.
            </p>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="btn btn-ghost"
                onClick={() => dialogRef.current?.close()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-destructive"
                disabled={removing}
                onClick={async () => {
                  setRemoving(true);
                  const ok = await store.remove();
                  setRemoving(false);
                  dialogRef.current?.close();
                  if (ok) {
                    setTouched(new Set());
                    setDraft(draftFrom(null, props.numPages));
                  }
                }}
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
};
