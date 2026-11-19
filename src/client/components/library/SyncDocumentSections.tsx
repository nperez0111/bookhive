import { useState, type FC } from "hono/jsx/dom";

import { AnchoredMenu, MenuConfirm, MenuItem } from "./AnchoredMenu";
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

/** One decision row shared by the two prompt sections above the grid. */
const PromptRow: FC<{
  doc: SyncDoc;
  action: { label: string; onClick: (doc: SyncDoc) => void };
  onDismiss?: (document: string) => void;
}> = ({ doc, action, onDismiss }) => (
  <li class="flex flex-wrap items-center gap-3 py-2.5">
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-foreground">{syncDocName(doc)}</p>
      <p class="mt-0.5 truncate text-xs text-muted-foreground">{syncDocMeta(doc)}</p>
      <MiniProgress percentage={doc.percentage} />
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button type="button" class="btn btn-sm min-h-10" onClick={() => action.onClick(doc)}>
        {action.label}
      </button>
      {onDismiss && (
        <button
          type="button"
          class="btn btn-ghost btn-sm min-h-10"
          onClick={() => onDismiss(doc.document)}
        >
          Not on BookHive
        </button>
      )}
    </div>
  </li>
);

/**
 * Matched documents whose book is not in the user's library. Auto-matching only
 * links the catalogue book; adding it is an explicit decision, made one row at
 * a time, because it creates a real PDS record.
 */
export const UnaddedBooks: FC<{
  docs: SyncDoc[];
  onAdd: (doc: SyncDoc) => void;
}> = ({ docs, onAdd }) => {
  if (docs.length === 0) return null;

  return (
    <div class="mb-6 rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <h2 class="text-sm font-semibold text-foreground">
        {docs.length === 1
          ? "1 book from your e-reader isn't in your library"
          : `${docs.length} books from your e-reader aren't in your library`}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">
        We matched these, but they aren't in your library yet. Add a book to keep the progress your
        e-reader already reported.
      </p>
      <ul class="divide-border mt-3 divide-y">
        {docs.map((doc) => (
          <PromptRow
            key={doc.document}
            doc={doc}
            action={{ label: "Add to library", onClick: onAdd }}
          />
        ))}
      </ul>
    </div>
  );
};

/**
 * Documents with no BookHive counterpart yet. Unlike the matched list above,
 * these need the user to pick the book (or dismiss them).
 */
export const UnlinkedBooks: FC<{
  docs: SyncDoc[];
  onLink: (doc: SyncDoc) => void;
  onDismiss: (document: string) => void;
}> = ({ docs, onLink, onDismiss }) => {
  if (docs.length === 0) return null;

  return (
    <div class="mb-6 rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <h2 class="text-sm font-semibold text-foreground">
        {docs.length === 1
          ? "1 book from your e-reader we couldn't match"
          : `${docs.length} books from your e-reader we couldn't match`}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">
        We're tracking their progress but don't know which BookHive book they are. Match them, or
        tell us they aren't on BookHive.
      </p>
      <ul class="divide-border mt-3 divide-y">
        {docs.map((doc) => (
          <PromptRow
            key={doc.document}
            doc={doc}
            action={{ label: "Link to book", onClick: onLink }}
            onDismiss={onDismiss}
          />
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
  onDelete: (document: string) => void;
}> = ({ doc, onLink, onRename, onDelete }) => {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(doc.title ?? "");
  const [busy, setBusy] = useState(false);

  // Unique per row; used as the id of the checkbox holding the menu's open state.
  const menuId = `sync-doc-menu-${doc.document}`;

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
    <li class="flex flex-wrap items-center gap-3 py-3">
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

      <div class="flex shrink-0 items-center gap-1">
        {doc.hiveId ? (
          <a href={`/books/${doc.hiveId}`} class="truncate text-xs text-primary hover:underline">
            {doc.bookTitle || "Linked"}
          </a>
        ) : (
          // No explicit undo: linking a dismissed document overwrites the
          // sentinel, which is the only correction that matters.
          <button type="button" class="btn btn-ghost btn-sm min-h-10" onClick={() => onLink(doc)}>
            Link to book
          </button>
        )}

        <AnchoredMenu id={menuId} label={`Actions for ${syncDocName(doc)}`} width="w-44">
          <MenuItem menuId={menuId} onClick={() => setRenaming(true)}>
            Rename
          </MenuItem>
          <MenuConfirm
            id={`${menuId}-confirm`}
            menuId={menuId}
            label="Delete progress"
            description="Delete the synced progress for this book? It comes back if your e-reader syncs it again."
            confirmLabel="Delete progress"
            onConfirm={() => onDelete(doc.document)}
          />
        </AnchoredMenu>
      </div>
    </li>
  );
};

/**
 * Documents whose progress we keep syncing even though there's no file in the
 * library: either linked to a BookHive book, or explicitly marked as not being
 * on BookHive. A section of the page in its own right, not a footnote.
 */
export const AlsoTracking: FC<{
  docs: SyncDoc[];
  onLink: (doc: SyncDoc) => void;
  onRename: (document: string, title: string) => Promise<void>;
  onDelete: (document: string) => void;
}> = ({ docs, onLink, onRename, onDelete }) => {
  if (docs.length === 0) return null;

  return (
    <section class="mt-12 border-t border-border pt-8">
      <h2 class="flex items-baseline gap-2 text-xl font-bold text-foreground">
        Also tracking
        <span class="text-base font-normal text-muted-foreground tabular-nums">{docs.length}</span>
      </h2>
      <p class="text-muted-foreground mt-1 text-sm">
        Books your e-reader is syncing that don't have a file in your library. Their progress is
        still tracked.
      </p>
      <ul class="divide-border mt-4 divide-y border-t border-border">
        {docs.map((doc) => (
          <TrackedRow
            key={doc.document}
            doc={doc}
            onLink={onLink}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  );
};
