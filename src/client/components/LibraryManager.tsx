import { useCallback, useEffect, useRef, useState, type FC } from "hono/jsx/dom";

import type { HiveBook } from "../../types";
import { SearchPalette } from "./SearchPalette";
import { PersonalBookCard } from "./library/PersonalBookCard";
import { ShelfTabs } from "./library/ShelfTabs";
import { AlsoTracking, SyncTriage } from "./library/SyncDocumentSections";
import type { PersonalBook, Shelf, SyncDoc } from "./library/types";

const PAGE_SIZE = 24;

/** What the SearchPalette selection should be applied to once a book is picked. */
type LinkTarget = { kind: "book"; contentHash: string } | { kind: "document"; document: string };

const postJson = (url: string, body: unknown): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * These endpoints sit behind the app's global `etag` middleware, so a plain
 * re-fetch of the same URL after a mutation is served from the browser cache and
 * shows pre-mutation state (a dismissed document reappearing in the triage
 * strip, say). Always go to the network — this data is per-user and private.
 */
const getJson = (url: string): Promise<Response> => fetch(url, { cache: "no-store" });

/**
 * The personal library manager: the OPDS catalog and e-reader sync progress in
 * one view.
 *
 * Personal books and synced documents are keyed by the same KOReader partial
 * MD5, so a document with a matching file is folded into the grid card (as a
 * progress bar) rather than listed separately. Documents with no file are
 * triaged above the grid, or parked in "Also tracking" below it once the user
 * has linked or dismissed them.
 */
export const LibraryManager: FC = () => {
  const [books, setBooks] = useState<PersonalBook[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const [docs, setDocs] = useState<SyncDoc[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelvesLoaded, setShelvesLoaded] = useState(false);
  const [totalBooks, setTotalBooks] = useState(0);

  const [activeShelfId, setActiveShelfId] = useState<number | null>(null);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const openPaletteRef = useRef<((initialQuery?: string) => void) | null>(null);

  // ── Fetching ──

  const libraryUrl = (shelfId: number | null, from?: string): string => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (shelfId != null) params.set("shelfId", String(shelfId));
    if (from) params.set("cursor", from);
    return `/xrpc/buzz.bookhive.getPersonalLibrary?${params}`;
  };

  const fetchBooks = useCallback((shelfId: number | null) => {
    // Deliberately not clearing `books` here: blanking the grid on every tab
    // switch causes a full-height layout jump. We dim instead.
    setRefreshing(true);
    setError(false);
    getJson(libraryUrl(shelfId))
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((d: { books: PersonalBook[]; total?: number; cursor?: string }) => {
        setBooks(d.books);
        setCursor(d.cursor);
        if (shelfId === null) setTotalBooks(d.total ?? d.books.length);
      })
      .catch(() => setError(true))
      .finally(() => setRefreshing(false));
  }, []);

  const loadMore = () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    getJson(libraryUrl(activeShelfId, cursor))
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((d: { books: PersonalBook[]; cursor?: string }) => {
        setBooks((prev) => [...(prev ?? []), ...d.books]);
        setCursor(d.cursor);
      })
      .catch(() => {
        // leave the cursor in place so the user can retry
      })
      .finally(() => setLoadingMore(false));
  };

  const fetchShelves = useCallback(() => {
    getJson("/library/shelves")
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((d: { shelves: Shelf[] }) => setShelves(d.shelves))
      .catch(() => {
        // a missing shelf list just means no tabs
      })
      .finally(() => setShelvesLoaded(true));
  }, []);

  const fetchDocs = useCallback(() => {
    getJson("/library/sync/documents")
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((d: { documents: SyncDoc[] }) => setDocs(d.documents))
      .catch(() => setDocs([]));
  }, []);

  useEffect(() => {
    fetchBooks(activeShelfId);
  }, [activeShelfId, fetchBooks]);

  useEffect(() => {
    fetchShelves();
    fetchDocs();
  }, [fetchShelves, fetchDocs]);

  // Uploading is a full form POST + redirect, so returning to this page from
  // the bfcache would otherwise show a stale grid.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      fetchBooks(activeShelfId);
      fetchShelves();
      fetchDocs();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [activeShelfId, fetchBooks, fetchShelves, fetchDocs]);

  // ── Book actions ──

  const patchBook = (contentHash: string, patch: Partial<PersonalBook>) =>
    setBooks((prev) =>
      (prev ?? []).map((b) => (b.contentHash === contentHash ? { ...b, ...patch } : b)),
    );

  const handleUnlink = async (contentHash: string) => {
    try {
      const res = await postJson("/xrpc/buzz.bookhive.unlinkPersonalBook", { contentHash });
      if (!res.ok) throw new Error("Failed");
      patchBook(contentHash, { hiveId: null });
      fetchDocs();
    } catch {
      // the card stays linked and the user can retry
    }
  };

  const handleDelete = async (contentHash: string) => {
    const previous = books;
    setBooks((prev) => (prev ?? []).filter((b) => b.contentHash !== contentHash));
    setTotalBooks((n) => Math.max(0, n - 1));
    try {
      const res = await postJson("/xrpc/buzz.bookhive.deletePersonalBook", { contentHash });
      if (!res.ok) throw new Error("Failed");
      // The file is gone but its sync document may live on, so it can reappear
      // in the triage/tracking sections.
      fetchDocs();
      fetchShelves();
    } catch {
      setBooks(previous);
      setTotalBooks((n) => n + 1);
    }
  };

  // ── Linking (shared by grid cards and sync document rows) ──

  const startLinkBook = (book: PersonalBook) => {
    setLinkTarget({ kind: "book", contentHash: book.contentHash });
    openPaletteRef.current?.(book.title);
  };

  const startLinkDoc = (doc: SyncDoc) => {
    setLinkTarget({ kind: "document", document: doc.document });
    openPaletteRef.current?.(doc.title || doc.filename || undefined);
  };

  const handleSelectBook = async (hiveBook: HiveBook) => {
    const target = linkTarget;
    setLinkTarget(null);
    if (!target) return;

    try {
      if (target.kind === "book") {
        const res = await postJson("/xrpc/buzz.bookhive.linkPersonalBook", {
          contentHash: target.contentHash,
          hiveId: hiveBook.id,
        });
        if (!res.ok) throw new Error("Failed");
        // Linking overwrites the file's title/authors with the hive book's, so
        // re-fetch rather than guessing at the new values.
        fetchBooks(activeShelfId);
      } else {
        const res = await postJson("/library/sync/link", {
          document: target.document,
          hiveId: hiveBook.id,
        });
        if (!res.ok) throw new Error("Failed");
      }
      fetchDocs();
    } catch {
      // nothing changes; the row keeps its "Link to book" button
    }
  };

  // ── Sync document actions ──

  const setDismissed = async (document: string, dismissed: boolean) => {
    const previous = docs;
    setDocs((prev) =>
      prev.map((d) => (d.document === document ? { ...d, dismissed, hiveId: null } : d)),
    );
    try {
      const res = await postJson("/library/sync/dismiss", { document, dismissed });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setDocs(previous);
    }
  };

  const handleRenameDoc = async (document: string, title: string) => {
    const previous = docs;
    setDocs((prev) => prev.map((d) => (d.document === document ? { ...d, title } : d)));
    try {
      const res = await postJson("/library/sync/rename", { document, title });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setDocs(previous);
    }
  };

  // ── Shelf actions ──

  const handleCreateShelf = async (name: string): Promise<string | null> => {
    try {
      const res = await postJson("/xrpc/buzz.bookhive.createPersonalShelf", { name });
      if (!res.ok) {
        return res.status === 409 || res.status === 400
          ? "A shelf with that name already exists."
          : "Could not create shelf.";
      }
      const data = (await res.json()) as { shelf: Shelf };
      setShelves((prev) => [...prev, data.shelf].sort((a, b) => a.name.localeCompare(b.name)));
      return null;
    } catch {
      return "Could not create shelf.";
    }
  };

  const handleRenameShelf = async (id: number, name: string): Promise<string | null> => {
    try {
      const res = await postJson("/xrpc/buzz.bookhive.updatePersonalShelf", { id, name });
      if (!res.ok) {
        return res.status === 409 || res.status === 400
          ? "A shelf with that name already exists."
          : "Could not rename shelf.";
      }
      const data = (await res.json()) as { shelf: Shelf };
      setShelves((prev) =>
        prev
          .map((s) => (s.id === id ? data.shelf : s))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      return null;
    } catch {
      return "Could not rename shelf.";
    }
  };

  const handleDeleteShelf = async (id: number): Promise<void> => {
    const previous = shelves;
    setShelves((prev) => prev.filter((s) => s.id !== id));
    if (activeShelfId === id) setActiveShelfId(null);
    setBooks((prev) =>
      (prev ?? []).map((b) => ({ ...b, shelfIds: (b.shelfIds ?? []).filter((s) => s !== id) })),
    );
    try {
      const res = await postJson("/xrpc/buzz.bookhive.deletePersonalShelf", { id });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setShelves(previous);
      fetchBooks(activeShelfId);
    }
  };

  const setMembership = (contentHash: string, shelfId: number, member: boolean) => {
    setBooks((prev) =>
      (prev ?? []).map((b) => {
        if (b.contentHash !== contentHash) return b;
        const ids = new Set(b.shelfIds ?? []);
        if (member) ids.add(shelfId);
        else ids.delete(shelfId);
        return { ...b, shelfIds: [...ids] };
      }),
    );
    setShelves((prev) =>
      prev.map((s) =>
        s.id === shelfId ? { ...s, bookCount: Math.max(0, s.bookCount + (member ? 1 : -1)) } : s,
      ),
    );
  };

  const handleAddToShelf = async (shelfId: number, contentHash: string) => {
    setMembership(contentHash, shelfId, true);
    try {
      const res = await postJson("/xrpc/buzz.bookhive.addToPersonalShelf", {
        shelfId,
        contentHash,
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setMembership(contentHash, shelfId, false);
    }
  };

  const handleRemoveFromShelf = async (shelfId: number, contentHash: string) => {
    setMembership(contentHash, shelfId, false);
    // When browsing that shelf, the book also leaves the current view.
    const wasVisible = activeShelfId === shelfId;
    if (wasVisible) setBooks((prev) => (prev ?? []).filter((b) => b.contentHash !== contentHash));
    try {
      const res = await postJson("/xrpc/buzz.bookhive.removeFromPersonalShelf", {
        shelfId,
        contentHash,
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setMembership(contentHash, shelfId, true);
      if (wasVisible) fetchBooks(activeShelfId);
    }
  };

  // ── Partition the sync documents ──

  // Documents backed by a file are already represented by their grid card.
  const orphanDocs = docs.filter((d) => !d.hasFile);
  const triageDocs = orphanDocs.filter((d) => !d.hiveId && !d.dismissed);
  const trackedDocs = orphanDocs.filter((d) => d.hiveId || d.dismissed);

  const isEmptyGrid = !error && books !== null && books.length === 0;

  return (
    <div>
      <SyncTriage
        docs={triageDocs}
        onLink={startLinkDoc}
        onDismiss={(document) => void setDismissed(document, true)}
      />

      {shelvesLoaded && (
        <ShelfTabs
          shelves={shelves}
          totalBooks={totalBooks}
          activeShelfId={activeShelfId}
          onSelect={setActiveShelfId}
          onCreate={handleCreateShelf}
          onRename={handleRenameShelf}
          onDelete={handleDeleteShelf}
        />
      )}

      {error && (
        <p class="mt-6 text-sm text-muted-foreground">
          Could not load your library. Try reloading the page.
        </p>
      )}

      {!error && books === null && (
        <p class="mt-6 text-sm text-muted-foreground">Loading your library...</p>
      )}

      {isEmptyGrid && (
        <div class="mt-6 rounded-lg border border-dashed border-border px-6 py-10 text-center">
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
            {activeShelfId !== null
              ? 'No books on this shelf yet. Add them from the "All books" tab.'
              : 'No books in your library yet. Use "Upload books" to add one.'}
          </p>
        </div>
      )}

      {books !== null && books.length > 0 && (
        <>
          <ul
            class={`mt-6 grid grid-cols-2 gap-4 transition-opacity duration-150 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 ${
              refreshing ? "opacity-50" : ""
            }`}
          >
            {books.map((book) => (
              <PersonalBookCard
                key={book.contentHash}
                book={book}
                shelves={shelves}
                activeShelfId={activeShelfId}
                onLink={startLinkBook}
                onUnlink={(hash) => void handleUnlink(hash)}
                onDelete={(hash) => void handleDelete(hash)}
                onAddToShelf={(shelfId, hash) => void handleAddToShelf(shelfId, hash)}
                onRemoveFromShelf={(shelfId, hash) => void handleRemoveFromShelf(shelfId, hash)}
              />
            ))}
          </ul>

          {cursor && (
            <div class="mt-6 flex justify-center">
              <button
                type="button"
                class="btn btn-secondary min-h-[40px]"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      <AlsoTracking
        docs={trackedDocs}
        onLink={startLinkDoc}
        onUndismiss={(document) => void setDismissed(document, false)}
        onRename={handleRenameDoc}
      />

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
