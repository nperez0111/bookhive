import { useEffect, useRef, useState, type FC } from "hono/jsx/dom";

import { AnchoredMenu, MenuConfirm, MenuItem } from "./AnchoredMenu";
import type { Shelf } from "./types";

const tabClass = (active: boolean): string =>
  `tab-label flex min-h-[40px] cursor-pointer items-center gap-1.5 px-3 py-2 text-sm font-medium transition-[color,border-color] duration-150 active:scale-[0.96] ${
    active
      ? "border-b-2 border-primary text-foreground"
      : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
  }`;

/**
 * "All books" plus one tab per personal shelf, with inline create/rename/delete.
 * Each shelf is also its own OPDS acquisition feed, so this is how users curate
 * what their e-reader sees.
 */
export const ShelfTabs: FC<{
  shelves: Shelf[];
  totalBooks: number;
  activeShelfId: number | null;
  onSelect: (id: number | null) => void;
  /** Resolves to an error message, or null on success. */
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: number, name: string) => Promise<string | null>;
  onDelete: (id: number) => Promise<void>;
}> = ({ shelves, totalBooks, activeShelfId, onSelect, onCreate, onRename, onDelete }) => {
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const createInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (renamingId !== null) renameInputRef.current?.focus();
  }, [renamingId]);

  const submitCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const err = await onCreate(name);
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      setCreateName("");
      setCreating(false);
    }
  };

  const submitRename = async (id: number) => {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const err = await onRename(id, name);
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      setRenamingId(null);
      setRenameValue("");
    }
  };

  return (
    <div>
      <div class="flex flex-wrap items-center gap-1 border-b border-border" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeShelfId === null ? "true" : "false"}
          class={tabClass(activeShelfId === null)}
          onClick={() => onSelect(null)}
        >
          All books
          <span class="text-xs text-muted-foreground tabular-nums">{totalBooks}</span>
        </button>

        {shelves.map((shelf) =>
          renamingId === shelf.id ? (
            <div key={shelf.id} class="flex min-h-[40px] items-center gap-1 px-2">
              <input
                ref={renameInputRef}
                type="text"
                class="h-8 rounded-md border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none"
                value={renameValue}
                maxLength={100}
                disabled={busy}
                onInput={(e) => {
                  setRenameValue((e.target as HTMLInputElement).value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitRename(shelf.id);
                  if (e.key === "Escape") {
                    setRenamingId(null);
                    setError(null);
                  }
                }}
              />
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => void submitRename(shelf.id)}
              >
                Save
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onClick={() => {
                  setRenamingId(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div key={shelf.id} class="group relative flex items-center">
              <button
                type="button"
                role="tab"
                aria-selected={activeShelfId === shelf.id ? "true" : "false"}
                class={tabClass(activeShelfId === shelf.id)}
                onClick={() => onSelect(shelf.id)}
              >
                {shelf.name}
                <span class="text-xs text-muted-foreground tabular-nums">{shelf.bookCount}</span>
              </button>

              {/* Always visible on the active tab: hover-only would leave shelf
                  rename/delete unreachable on touch devices. */}
              <AnchoredMenu
                id={`shelf-menu-${shelf.id}`}
                label={`Shelf actions for ${shelf.name}`}
                width="w-40"
                triggerClass={`mr-1 -ml-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-opacity duration-150 hover:bg-muted group-hover:opacity-100 ${
                  activeShelfId === shelf.id ? "opacity-100" : "opacity-0"
                }`}
                trigger={
                  <svg class="size-3" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="3" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="8" cy="13" r="1.5" />
                  </svg>
                }
              >
                <MenuItem
                  menuId={`shelf-menu-${shelf.id}`}
                  onClick={() => {
                    setRenameValue(shelf.name);
                    setRenamingId(shelf.id);
                  }}
                >
                  Rename
                </MenuItem>
                <MenuConfirm
                  id={`shelf-menu-${shelf.id}-confirm`}
                  menuId={`shelf-menu-${shelf.id}`}
                  label="Delete shelf"
                  description={`Delete the "${shelf.name}" shelf? The books stay in your library.`}
                  confirmLabel="Delete shelf"
                  onConfirm={() => void onDelete(shelf.id)}
                />
              </AnchoredMenu>
            </div>
          ),
        )}

        {creating ? (
          <div class="flex min-h-[40px] items-center gap-1 px-2">
            <input
              ref={createInputRef}
              type="text"
              class="h-8 rounded-md border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Shelf name"
              value={createName}
              maxLength={100}
              disabled={busy}
              onInput={(e) => {
                setCreateName((e.target as HTMLInputElement).value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setCreateName("");
                  setError(null);
                }
              }}
            />
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              disabled={busy || !createName.trim()}
              onClick={() => void submitCreate()}
            >
              Add
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={() => {
                setCreating(false);
                setCreateName("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            class="flex min-h-[40px] items-center gap-1 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground active:scale-[0.96]"
            onClick={() => setCreating(true)}
          >
            <svg
              class="size-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New shelf
          </button>
        )}
      </div>

      {error && <p class="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
};
