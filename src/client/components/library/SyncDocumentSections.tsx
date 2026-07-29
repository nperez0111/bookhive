import { useState, type FC } from "hono/jsx/dom";

import { syncDocMeta, syncDocName, toPercent, type SyncDoc } from "./types";

/** Slim progress bar shared by both sync document sections. */
const MiniProgress: FC<{ percentage: number }> = ({ percentage }) => {
  const percent = toPercent(percentage);
  return (
    <div class="mt-1 h-1 w-full max-w-40 overflow-hidden rounded-full bg-muted">
      <div
        class={`h-full rounded-full ${percent >= 100 ? "bg-green-500" : "bg-primary"}`}
        style={`width: ${percent}%`}
      />
    </div>
  );
};

/**
 * Documents the e-reader is tracking that we can't place: no uploaded file with
 * a matching hash, no linked BookHive book, and not yet dismissed. Shown above
 * the grid because each one is a decision the user needs to make once.
 */
export const SyncTriage: FC<{
  docs: SyncDoc[];
  onLink: (doc: SyncDoc) => void;
  onDismiss: (document: string) => void;
}> = ({ docs, onLink, onDismiss }) => {
  if (docs.length === 0) return null;

  return (
    <div class="mb-6 rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <h2 class="text-sm font-semibold text-foreground">
        {docs.length === 1
          ? "1 book from your e-reader isn't in your library"
          : `${docs.length} books from your e-reader aren't in your library`}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">
        We're tracking their progress but don't know what they are. Match them to a BookHive book,
        or tell us they aren't on BookHive.
      </p>

      <ul class="divide-border mt-3 divide-y">
        {docs.map((doc) => (
          <li key={doc.document} class="flex flex-wrap items-center gap-3 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-foreground">{syncDocName(doc)}</p>
              <p class="mt-0.5 truncate text-xs text-muted-foreground">{syncDocMeta(doc)}</p>
              <MiniProgress percentage={doc.percentage} />
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button type="button" class="btn btn-sm min-h-10" onClick={() => onLink(doc)}>
                Link to book
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm min-h-10"
                onClick={() => onDismiss(doc.document)}
              >
                Not on BookHive
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** One row of the "Also tracking" list, with inline renaming. */
const TrackedRow: FC<{
  doc: SyncDoc;
  onLink: (doc: SyncDoc) => void;
  onRename: (document: string, title: string) => Promise<void>;
}> = ({ doc, onLink, onRename }) => {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(doc.title ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const title = value.trim();
    if (!title || title === doc.title) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    await onRename(doc.document, title);
    setBusy(false);
    setRenaming(false);
  };

  return (
    <li class="flex flex-wrap items-center gap-3 py-2.5">
      <div class="min-w-0 flex-1">
        {renaming ? (
          <div class="flex items-center gap-1">
            <input
              type="text"
              class="h-8 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none"
              value={value}
              maxLength={300}
              disabled={busy}
              autofocus
              onInput={(e) => setValue((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") {
                  setValue(doc.title ?? "");
                  setRenaming(false);
                }
              }}
            />
            <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onClick={submit}>
              Save
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={() => {
                setValue(doc.title ?? "");
                setRenaming(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <p class="truncate text-sm font-medium text-foreground">
            {syncDocName(doc)}
            {doc.dismissed && (
              <span class="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                Not on BookHive
              </span>
            )}
          </p>
        )}
        <p class="mt-0.5 truncate text-xs text-muted-foreground">{syncDocMeta(doc)}</p>
        <MiniProgress percentage={doc.percentage} />
      </div>

      <div class="flex shrink-0 items-center gap-2">
        {doc.hiveId ? (
          <a href={`/books/${doc.hiveId}`} class="truncate text-xs text-primary hover:underline">
            {doc.bookTitle || "Linked"}
          </a>
        ) : (
          <>
            {!renaming && (
              <button
                type="button"
                class="btn btn-ghost btn-sm min-h-10"
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
            )}
            {/* No explicit undo: linking a dismissed document overwrites the
                sentinel, which is the only correction that matters. */}
            <button type="button" class="btn btn-ghost btn-sm min-h-10" onClick={() => onLink(doc)}>
              Link to book
            </button>
          </>
        )}
      </div>
    </li>
  );
};

/**
 * Documents whose progress we keep syncing even though there's no file in the
 * library: either linked to a BookHive book, or explicitly marked as not being
 * on BookHive. A plain section rather than a card — it reads as a continuation
 * of the library, not a separate object.
 */
export const AlsoTracking: FC<{
  docs: SyncDoc[];
  onLink: (doc: SyncDoc) => void;
  onRename: (document: string, title: string) => Promise<void>;
}> = ({ docs, onLink, onRename }) => {
  if (docs.length === 0) return null;

  return (
    <section class="mt-10 border-t border-border pt-6">
      <h2 class="flex items-baseline gap-1.5 text-sm font-semibold text-foreground">
        Also tracking
        <span class="text-muted-foreground tabular-nums">({docs.length})</span>
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">
        Books your e-reader is syncing that don't have a file in your library. Their progress is
        still tracked.
      </p>
      <ul class="divide-border mt-2 divide-y">
        {docs.map((doc) => (
          <TrackedRow key={doc.document} doc={doc} onLink={onLink} onRename={onRename} />
        ))}
      </ul>
    </section>
  );
};
