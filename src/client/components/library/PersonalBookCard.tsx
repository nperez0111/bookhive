import type { FC } from "hono/jsx/dom";

import { AnchoredMenu, MenuConfirm, MenuItem } from "./AnchoredMenu";
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
  const menuId = `personal-book-menu-${book.contentHash}`;
  const percent = bookPercent(book);
  const href = book.hiveId ? `/books/${book.hiveId}` : undefined;
  const shelfIds = new Set(book.shelfIds ?? []);
  const meta = [book.format.toUpperCase(), formatFileSize(book.sizeBytes)].join(" · ");

  return (
    // Raised while its menu is open so the panel paints over the grid cards that
    // come after it in DOM order.
    <li class="relative has-[:checked]:z-20">
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
            can overflow it. Mirrors the cover's hover lift to stay aligned, but
            with `bottom` rather than a transform: a transform here would become
            the containing block for the menu's `fixed` light-dismiss backdrop
            (shrinking it to this card) and would trap the panel in its own
            stacking context. `inset-x-0 top-0 bottom-0` instead of `inset-0`
            keeps the hover offset a same-property override, so there is no
            shorthand-vs-longhand ordering question.
            `group-has-[:checked]` keeps the layer up while the menu is open —
            the trigger is a label, so it holds no focus for `focus-within`. */}
        <div class="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex flex-col justify-end p-2 opacity-0 transition-[opacity,bottom] duration-200 group-focus-within:opacity-100 group-hover:bottom-1 group-hover:opacity-100 group-has-[:checked]:bottom-1 group-has-[:checked]:opacity-100">
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

            <AnchoredMenu id={menuId} label={`Manage ${book.title}`}>
              {book.hiveId ? (
                <MenuItem menuId={menuId} onClick={() => onUnlink(book.contentHash)}>
                  Unlink from BookHive
                </MenuItem>
              ) : (
                <MenuItem menuId={menuId} onClick={() => onLink(book)}>
                  Link to a BookHive book
                </MenuItem>
              )}

              {shelves.length > 0 && (
                <>
                  <p class="mt-1 border-t border-border px-3 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                    Shelves
                  </p>
                  {shelves.map((shelf) => {
                    const isOn = shelfIds.has(shelf.id);
                    return (
                      // No menuId: toggling several shelves in a row should not
                      // close the menu each time.
                      <MenuItem
                        key={shelf.id}
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
                          {isOn ? "\u2713" : ""}
                        </span>
                        <span class="truncate">{shelf.name}</span>
                      </MenuItem>
                    );
                  })}
                </>
              )}

              <div class="mt-1 border-t border-border pt-1">
                <MenuConfirm
                  id={`${menuId}-confirm`}
                  menuId={menuId}
                  label="Delete from library"
                  description={`Delete "${book.title}" and its file from your library? This cannot be undone.`}
                  confirmLabel="Delete file"
                  onConfirm={() => onDelete(book.contentHash)}
                />
              </div>
            </AnchoredMenu>
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
