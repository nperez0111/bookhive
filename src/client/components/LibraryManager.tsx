import { useEffect, useRef, useState, type FC } from "hono/jsx/dom";

import type { HiveBook } from "../../types";
import { SearchPalette } from "./SearchPalette";

type PersonalBook = {
  contentHash: string;
  title: string;
  authors: string | null;
  language: string | null;
  format: string;
  mime: string;
  sizeBytes: number;
  coverUrl: string | null;
  hiveId: string | null;
  createdAt: string;
  updatedAt: string;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatBadge = (format: string): string => format.toUpperCase();

export const LibraryManager: FC = () => {
  const [books, setBooks] = useState<PersonalBook[] | null>(null);
  const [error, setError] = useState(false);
  const [linkingBook, setLinkingBook] = useState<string | null>(null);
  const [deletingBook, setDeletingBook] = useState<string | null>(null);
  const [filterShelfId] = useState<number | null>(null);
  const openPaletteRef = useRef<((initialQuery?: string) => void) | null>(null);

  const fetchBooks = () => {
    setBooks(null);
    setError(false);
    let url = "/xrpc/buzz.bookhive.getPersonalLibrary?limit=100";
    if (filterShelfId != null) url += `&shelfId=${filterShelfId}`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((d: { books: PersonalBook[] }) => setBooks(d.books))
      .catch(() => setError(true));
  };

  useEffect(() => {
    fetchBooks();
  }, [filterShelfId]);

  // Re-fetch when the page is restored from bfcache (e.g. after upload redirect)
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) fetchBooks();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const handleLink = async (contentHash: string, book: HiveBook) => {
    try {
      const res = await fetch("/xrpc/buzz.bookhive.linkPersonalBook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentHash, hiveId: book.id }),
      });
      if (!res.ok) throw new Error("Failed");
      setBooks((prev) =>
        (prev ?? []).map((b) =>
          b.contentHash === contentHash ? { ...b, hiveId: book.id as string } : b,
        ),
      );
    } catch {
      // ignore — the row stays unlinked and the user can retry
    }
  };

  const handleUnlink = async (contentHash: string) => {
    try {
      const res = await fetch("/xrpc/buzz.bookhive.unlinkPersonalBook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentHash }),
      });
      if (!res.ok) throw new Error("Failed");
      setBooks((prev) =>
        (prev ?? []).map((b) => (b.contentHash === contentHash ? { ...b, hiveId: null } : b)),
      );
    } catch {
      // ignore
    }
  };

  const handleDelete = async (contentHash: string) => {
    try {
      const res = await fetch("/xrpc/buzz.bookhive.deletePersonalBook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentHash }),
      });
      if (!res.ok) throw new Error("Failed");
      setBooks((prev) => (prev ?? []).filter((b) => b.contentHash !== contentHash));
    } catch {
      // ignore
    }
  };

  const startLink = (contentHash: string, title: string) => {
    setLinkingBook(contentHash);
    openPaletteRef.current?.(title);
  };

  const handleSelectBook = async (book: HiveBook) => {
    const contentHash = linkingBook;
    if (!contentHash) return;
    await handleLink(contentHash, book);
    setLinkingBook(null);
  };

  return (
    <div class="mt-4">
      {!error && books === null && (
        <p class="text-muted-foreground mt-2 text-sm">Loading your library...</p>
      )}

      {error && <p class="text-muted-foreground mt-2 text-sm">Could not load your library.</p>}

      {!error && books !== null && books.length === 0 && (
        <div class="mt-4 rounded-lg border border-dashed border-border px-6 py-8 text-center">
          <svg
            class="mx-auto size-10 text-muted-foreground/50"
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
          <p class="mt-3 text-sm text-muted-foreground">
            No books in your library yet. Upload an ebook above to get started.
          </p>
        </div>
      )}

      {books !== null && books.length > 0 && (
        <ul class="divide-border mt-4 divide-y rounded-md border border-border">
          {books.map((book) => (
            <li key={book.contentHash} class="flex items-center gap-3 px-3 py-3">
              {/* Cover or format badge */}
              <div class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground uppercase">
                {book.coverUrl ? (
                  <img
                    class="size-12 rounded-md object-cover"
                    src={book.coverUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  formatBadge(book.format)
                )}
              </div>

              {/* Book info */}
              <div class="min-w-0 flex-1">
                <p class="text-foreground truncate text-sm font-medium">
                  {book.hiveId ? (
                    <a href={`/books/${book.hiveId}`} class="hover:text-primary hover:underline">
                      {book.title}
                    </a>
                  ) : (
                    book.title
                  )}
                </p>
                <p class="text-muted-foreground mt-0.5 truncate text-xs">
                  {[book.authors, formatBadge(book.format), formatFileSize(book.sizeBytes)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              {/* Actions */}
              <div class="flex shrink-0 items-center gap-2">
                {book.hiveId ? (
                  <>
                    <a
                      href={`/books/${book.hiveId}`}
                      class="text-primary truncate text-xs hover:underline"
                    >
                      Linked
                    </a>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onClick={() => void handleUnlink(book.contentHash)}
                    >
                      Unlink
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    class="btn btn-sm"
                    onClick={() => startLink(book.contentHash, book.title)}
                  >
                    Link to book
                  </button>
                )}
                {deletingBook === book.contentHash ? (
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="btn btn-sm text-destructive"
                      onClick={() => {
                        void handleDelete(book.contentHash);
                        setDeletingBook(null);
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onClick={() => setDeletingBook(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm text-destructive"
                    onClick={() => setDeletingBook(book.contentHash)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SearchPalette
        isLoggedIn={true}
        onRegisterOpen={(fn) => {
          openPaletteRef.current = fn;
        }}
        onSelectBook={(book) => void handleSelectBook(book)}
        placeholder="Search for the matching book..."
      />
    </div>
  );
};
