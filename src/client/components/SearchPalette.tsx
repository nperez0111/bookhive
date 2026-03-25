import { useEffect, useRef, useState, type FC } from "hono/jsx/dom";
import { getHotkeyManager } from "@tanstack/hotkeys";

import { FINISHED, READING, WANTTOREAD } from "../../constants";
import { ProgressBar } from "./ProgressBar";
import { useDebounce } from "./utils/useDebounce";
import { useSearchBooks } from "./utils/useSearchBooks";

const STATUS_OPTIONS = [
  { value: WANTTOREAD, label: "Want to Read" },
  { value: READING, label: "Reading" },
  { value: FINISHED, label: "Read" },
] as const;

export const SearchPalette: FC<{
  isLoggedIn: boolean;
  onRegisterOpen: (fn: () => void) => void;
}> = ({ isLoggedIn, onRegisterOpen }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMap, setStatusMap] = useState<Record<string, string | null>>({});
  const [statusPending, setStatusPending] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const debouncedQuery = useDebounce(query, 300);
  const bookResults = useSearchBooks(debouncedQuery, debouncedQuery.length > 2, 20);
  const books = bookResults.data ?? [];

  // Seed statusMap from server-provided user statuses when results change
  useEffect(() => {
    if (bookResults.userStatuses && Object.keys(bookResults.userStatuses).length > 0) {
      setStatusMap((prev) => ({ ...bookResults.userStatuses, ...prev }));
    }
  }, [bookResults.userStatuses]);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);

  // Register the open fn so the trigger button can call it
  useEffect(() => {
    onRegisterOpen(open);
  }, []);

  // CMD+K / Ctrl+K hotkey
  useEffect(() => {
    const manager = getHotkeyManager();
    const handle = manager.register("Mod+K", () => setIsOpen((v) => !v));
    return () => handle.unregister();
  }, []);

  // Animate in: open → render → next frame set visible
  useEffect(() => {
    if (isOpen) {
      setIsVisible(false);
      requestAnimationFrame(() => setIsVisible(true));
      setQuery("");
      setSelectedIndex(0);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (!isOpen) return;
    // slight delay to let animation start
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Reset selectedIndex when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [books.length, debouncedQuery]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const focusInput = () => inputRef.current?.focus();

  const getSelectedButtons = (): HTMLElement[] => {
    const list = listRef.current;
    if (!list) return [];
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    return item ? Array.from(item.querySelectorAll<HTMLElement>("button")) : [];
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, books.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Tab":
        if (isLoggedIn && books.length > 0) {
          const buttons = getSelectedButtons();
          if (buttons.length > 0) {
            e.preventDefault();
            buttons[0]?.focus();
          }
        }
        break;
      case "Enter":
        e.preventDefault();
        if (books[selectedIndex]) {
          window.location.href = `/books/${books[selectedIndex].id}`;
        } else if (debouncedQuery.length > 2) {
          window.location.href = `/search?q=${encodeURIComponent(debouncedQuery)}`;
        }
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  };

  const handleStatusKeyDown = (e: KeyboardEvent, buttonIndex: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown": {
        e.preventDefault();
        e.stopPropagation();
        const buttons = getSelectedButtons();
        buttons[Math.min(buttonIndex + 1, buttons.length - 1)]?.focus();
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        e.preventDefault();
        e.stopPropagation();
        if (buttonIndex === 0) {
          focusInput();
        } else {
          getSelectedButtons()[buttonIndex - 1]?.focus();
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        focusInput();
        break;
    }
  };

  const handleStatusClick = async (hiveId: string, status: string) => {
    const previous = statusMap[hiveId] ?? null;
    setStatusMap((m) => ({ ...m, [hiveId]: status === previous ? null : status }));
    setStatusPending((p) => ({ ...p, [hiveId]: true }));
    try {
      const res = await fetch("/api/update-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiveId, status: status === previous ? null : status }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setStatusMap((m) => ({ ...m, [hiveId]: previous }));
    } finally {
      setStatusPending((p) => ({ ...p, [hiveId]: false }));
    }
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Search books">
      {/* Backdrop */}
      <div
        class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        style={`transition: opacity 150ms; opacity: ${isVisible ? 1 : 0}`}
        onClick={close}
      />

      {/* Palette card */}
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          class="bg-card ring-1 ring-border w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col"
          style={`transition: opacity 150ms, transform 150ms; opacity: ${isVisible ? 1 : 0}; transform: scale(${isVisible ? 1 : 0.95})`}
          onKeyDown={(e) => handleKeyDown(e as unknown as KeyboardEvent)}
        >
          {/* Search input row */}
          <div class="flex items-center gap-3 border-b border-border px-4">
            <svg
              class="size-5 shrink-0 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search books..."
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              class="flex-1 bg-transparent py-4 my-[3px] text-foreground placeholder:text-muted-foreground [outline:none] border border-border focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400 focus:ring-offset-0 rounded text-base"
              autocomplete="off"
              role="combobox"
              aria-expanded={books.length > 0}
              aria-controls="palette-results"
            />
            <kbd
              class="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground cursor-pointer sm:inline"
              onClick={close}
            >
              ESC
            </kbd>
          </div>

          <ProgressBar isActive={bookResults.isFetching} />

          {/* Results */}
          <ul
            ref={listRef}
            id="palette-results"
            role="listbox"
            class="overflow-y-auto divide-y divide-border"
            style="max-height: min(60vh, 500px)"
          >
            {bookResults.isError && (
              <li class="px-4 py-3 text-sm text-red-500">Failed to search books</li>
            )}

            {debouncedQuery.length > 2 && !bookResults.isFetching && books.length === 0 && (
              <li class="px-4 py-6 text-sm text-center text-muted-foreground">No results found</li>
            )}

            {debouncedQuery.length <= 2 && (
              <li class="px-4 py-6 text-sm text-center text-muted-foreground">
                Type at least 3 characters to search...
              </li>
            )}

            {books.map((book, index) => {
              const currentStatus = statusMap[book.id] ?? null;
              const isPending = statusPending[book.id] ?? false;
              const isSelected = index === selectedIndex;

              return (
                <li
                  key={book.id}
                  id={`palette-book-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  class={`flex items-center gap-4 px-4 py-3 transition-colors ${isSelected ? "bg-muted" : "hover:bg-muted/50"}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {/* Cover */}
                  <a
                    href={`/books/${book.id}`}
                    class="shrink-0"
                    tabIndex={-1}
                    onClick={close}
                    onKeyDown={(e) => {
                      if ((e as unknown as KeyboardEvent).key === "Escape") close();
                    }}
                  >
                    <img
                      class="h-16 w-auto rounded-sm object-cover shadow-sm aspect-2/3"
                      src={book.thumbnail || book.cover || ""}
                      alt={`Cover of ${book.title}`}
                      loading="lazy"
                    />
                  </a>

                  {/* Info */}
                  <a
                    href={`/books/${book.id}`}
                    class="flex-1 min-w-0 group"
                    tabIndex={-1}
                    onClick={close}
                  >
                    <p class="text-sm font-semibold text-foreground truncate group-hover:text-primary">
                      {book.title}
                    </p>
                    <p class="text-xs text-muted-foreground truncate mt-0.5">
                      by {book.authors.split("\t").join(", ")}
                    </p>
                  </a>

                  {/* Status buttons */}
                  {isLoggedIn && (
                    <div class="flex shrink-0 items-center gap-1.5 ml-auto">
                      {STATUS_OPTIONS.map(({ value, label }, btnIndex) => {
                        const isActive = currentStatus === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            tabIndex={-1}
                            disabled={isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleStatusClick(book.id, value);
                            }}
                            onKeyDown={(e) =>
                              handleStatusKeyDown(e as unknown as KeyboardEvent, btnIndex)
                            }
                            class={`rounded px-2 py-1 text-[11px] font-medium transition-colors border ${
                              isActive
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border text-muted-foreground hover:border-primary hover:text-primary bg-transparent"
                            } ${isPending ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                            title={isActive ? `Remove "${label}" status` : `Mark as "${label}"`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Footer */}
          {debouncedQuery.length > 2 && (
            <div class="border-t border-border px-4 py-2 flex items-center gap-4 text-[11px] text-muted-foreground">
              {books.length > 0 && (
                <>
                  <span>
                    <kbd class="font-sans">↑↓</kbd> navigate
                  </span>
                  <span>
                    <kbd class="font-sans">↵</kbd> open
                  </span>
                </>
              )}
              <span>
                <kbd class="font-sans">esc</kbd> close
              </span>
              <a
                href={`/search?q=${encodeURIComponent(debouncedQuery)}`}
                class="ml-auto text-primary hover:underline"
                onClick={close}
              >
                See all results →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
