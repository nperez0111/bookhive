import { useEffect, useRef, useState, type FC } from "hono/jsx/dom";

import {
  authorsDisplay,
  bookPercent,
  formatFileSize,
  type PersonalBook,
  type Shelf,
} from "./types";

const DownloadIcon: FC = () => (
  <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  </svg>
);

const MoreIcon: FC = () => (
  <svg class="size-4" fill="currentColor" viewBox="0 0 16 16">
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="13" cy="8" r="1.5" />
  </svg>
);

/** Placeholder shown when neither the file nor a linked hive book has a cover. */
const FormatPlaceholder: FC<{ format: string }> = ({ format }) => (
  <div class="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted">
    <svg
      class="size-8 text-muted-foreground/50"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
      />
    </svg>
    <span class="text-xs font-bold tracking-wide text-muted-foreground uppercase">{format}</span>
  </div>
);

/**
 * One book in the library grid. Mirrors the dense `BookCard` used across the
 * rest of the app (`src/pages/components/BookCard.tsx`) — that component is
 * server-side `hono/jsx` and can't be imported into this island — and adds the
 * library-specific affordances: format/size, e-reader progress, and a hover
 * overlay for download and management.
 */
export const PersonalBookCard: FC<{
  book: PersonalBook;
  shelves: Shelf[];
  /** Non-null when the grid is filtered to a single shelf. */
  activeShelfId: number | null;
  onLink: (book: PersonalBook) => void;
  onUnlink: (contentHash: string) => void;
  onDelete: (contentHash: string) => void;
  onAddToShelf: (shelfId: number, contentHash: string) => void;
  onRemoveFromShelf: (shelfId: number, contentHash: string) => void;
}> = ({
  book,
  shelves,
  activeShelfId,
  onLink,
  onUnlink,
  onDelete,
  onAddToShelf,
  onRemoveFromShelf,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const percent = bookPercent(book);
  const href = book.hiveId ? `/books/${book.hiveId}` : undefined;
  const shelfIds = new Set(book.shelfIds ?? []);
  const meta = [book.format.toUpperCase(), formatFileSize(book.sizeBytes)].join(" · ");

  return (
    // Raise the whole card while its menu is open so the panel paints above
    // neighbouring grid items.
    <li class={`relative ${menuOpen ? "z-30" : ""}`}>
      <div class="group relative">
        {/* Cover. Clips the image and gradient to the rounded corners — which is
            why the action layer below is a sibling rather than a child: a menu
            inside this box would be cut off by `overflow-hidden`. */}
        <div class="relative block aspect-[2/3] w-full overflow-hidden rounded-lg shadow-sm transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-md">
          {href ? (
            <a href={href} class="block h-full w-full">
              {book.coverUrl ? (
                <img
                  src={book.coverUrl}
                  alt={book.title}
                  class="book-cover h-full w-full object-cover"
                  style={`--book-cover-name: book-cover-${book.hiveId}`}
                  loading="lazy"
                />
              ) : (
                <FormatPlaceholder format={book.format} />
              )}
            </a>
          ) : book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              class="book-cover h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <FormatPlaceholder format={book.format} />
          )}

          {/* Scrim behind the hover actions */}
          <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100" />
        </div>

        {/* Action layer — a sibling of the clipped cover box so the menu panel
            can overflow it. Mirrors the cover's hover lift to stay aligned. */}
        <div class="pointer-events-none absolute inset-0 flex flex-col justify-end p-2 opacity-0 transition-[opacity,transform] duration-200 group-focus-within:opacity-100 group-hover:-translate-y-1 group-hover:opacity-100">
          <div class="pointer-events-auto flex items-center justify-between gap-2">
            <a
              href={`/library/books/${book.contentHash}/download`}
              class="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-white/15 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-white/30 active:scale-[0.96]"
              title={`Download ${book.title}`}
              aria-label={`Download ${book.title}`}
              download
            >
              <DownloadIcon />
            </a>

            <div class="relative" ref={menuRef}>
              <button
                type="button"
                class="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-white/15 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-white/30 active:scale-[0.96]"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={`Manage ${book.title}`}
              >
                <MoreIcon />
              </button>

              {menuOpen && (
                <div class="absolute right-0 bottom-full z-20 mb-1 w-48 rounded-md border border-border bg-popover py-1 text-left shadow-md">
                  {book.hiveId ? (
                    <button
                      type="button"
                      class="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                      onClick={() => {
                        setMenuOpen(false);
                        onUnlink(book.contentHash);
                      }}
                    >
                      Unlink from BookHive
                    </button>
                  ) : (
                    <button
                      type="button"
                      class="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                      onClick={() => {
                        setMenuOpen(false);
                        onLink(book);
                      }}
                    >
                      Link to a BookHive book
                    </button>
                  )}

                  {shelves.length > 0 && (
                    <>
                      <p class="mt-1 border-t border-border px-3 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                        Shelves
                      </p>
                      {shelves.map((shelf) => {
                        const isOn = shelfIds.has(shelf.id);
                        return (
                          <button
                            key={shelf.id}
                            type="button"
                            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                            onClick={() =>
                              isOn
                                ? onRemoveFromShelf(shelf.id, book.contentHash)
                                : onAddToShelf(shelf.id, book.contentHash)
                            }
                          >
                            <span
                              class={`flex size-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                isOn
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border"
                              }`}
                            >
                              {isOn ? "✓" : ""}
                            </span>
                            <span class="truncate">{shelf.name}</span>
                          </button>
                        );
                      })}
                    </>
                  )}

                  <div class="mt-1 border-t border-border pt-1">
                    {confirmDelete ? (
                      <div class="flex items-center gap-2 px-3 py-1.5">
                        <button
                          type="button"
                          class="text-xs text-destructive hover:underline"
                          onClick={() => {
                            setMenuOpen(false);
                            setConfirmDelete(false);
                            onDelete(book.contentHash);
                          }}
                        >
                          Delete file
                        </button>
                        <button
                          type="button"
                          class="text-xs text-muted-foreground hover:underline"
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        class="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete from library
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Title + metadata */}
      {href ? (
        <a href={href} class="block">
          <h3
            class="book-title mt-2 line-clamp-2 text-sm leading-tight font-semibold text-foreground"
            style={`--book-title-name: book-title-${book.hiveId}`}
          >
            {book.title}
          </h3>
        </a>
      ) : (
        <h3 class="mt-2 line-clamp-2 text-sm leading-tight font-semibold text-foreground">
          {book.title}
        </h3>
      )}

      {book.authors && (
        <p class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {authorsDisplay(book.authors)}
        </p>
      )}
      <p class="mt-0.5 text-xs text-muted-foreground tabular-nums">{meta}</p>

      {percent !== null && (
        <div class="mt-1.5">
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              class={`h-full rounded-full transition-[width] duration-300 ${
                percent >= 100 ? "bg-green-500" : "bg-primary"
              }`}
              style={`width: ${percent}%`}
            />
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {percent >= 100 ? "Finished" : `${percent}% read`}
          </p>
        </div>
      )}

      {/* Quick removal when browsing a single shelf */}
      {activeShelfId !== null && (
        <button
          type="button"
          class="mt-1 text-xs text-muted-foreground hover:text-destructive hover:underline"
          onClick={() => onRemoveFromShelf(activeShelfId, book.contentHash)}
        >
          Remove from shelf
        </button>
      )}
    </li>
  );
};
