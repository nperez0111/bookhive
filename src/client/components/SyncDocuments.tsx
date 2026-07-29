import { useEffect, useRef, useState, type FC } from "hono/jsx/dom";

import type { HiveBook } from "../../types";
import { SearchPalette } from "./SearchPalette";

type SyncDoc = {
  document: string;
  title: string | null;
  authors: string | null;
  filename: string | null;
  percentage: number;
  device: string | null;
  updatedAt: string;
  hiveId: string | null;
  bookTitle: string | null;
};

const displayName = (doc: SyncDoc): string => doc.title || doc.filename || "Untitled document";

const formatSynced = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

// Secondary line: whichever identifying bits we have, joined by dots.
const metaLine = (doc: SyncDoc): string =>
  [
    doc.authors,
    `${Math.round(doc.percentage * 100)}% read`,
    doc.device,
    formatSynced(doc.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");

export const SyncDocuments: FC<{
  docsEndpoint?: string;
  linkEndpoint?: string;
}> = ({ docsEndpoint = "/settings/sync/documents", linkEndpoint = "/settings/sync/link" }) => {
  const [docs, setDocs] = useState<SyncDoc[] | null>(null);
  const [error, setError] = useState(false);
  const [linkingDoc, setLinkingDoc] = useState<string | null>(null);
  const openPaletteRef = useRef<((initialQuery?: string) => void) | null>(null);

  useEffect(() => {
    fetch(docsEndpoint)
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((d: { documents: SyncDoc[] }) => setDocs(d.documents))
      .catch(() => setError(true));
  }, []);

  const startLink = (document: string, title?: string | null) => {
    setLinkingDoc(document);
    openPaletteRef.current?.(title ?? undefined);
  };

  const handleSelectBook = async (book: HiveBook) => {
    const document = linkingDoc;
    if (!document) return;
    try {
      const res = await fetch(linkEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, hiveId: book.id }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { hiveId: string; bookTitle: string };
      setDocs((prev) =>
        (prev ?? []).map((d) =>
          d.document === document ? { ...d, hiveId: data.hiveId, bookTitle: data.bookTitle } : d,
        ),
      );
    } catch {
      // ignore — the row stays unlinked and the user can retry
    } finally {
      setLinkingDoc(null);
    }
  };

  return (
    <div class="mt-4">
      <h3 class="text-sm font-medium text-foreground">Synced documents</h3>

      {error && (
        <p class="text-muted-foreground mt-2 text-sm">Could not load your synced documents.</p>
      )}

      {!error && docs === null && <p class="text-muted-foreground mt-2 text-sm">Loading…</p>}

      {!error && docs !== null && docs.length === 0 && (
        <p class="text-muted-foreground mt-2 text-sm">
          No synced documents yet. Push progress from KOReader to see them here.
        </p>
      )}

      {docs !== null && docs.length > 0 && (
        <ul class="divide-border mt-2 divide-y rounded-md border border-border">
          {docs.map((doc) => (
            <li key={doc.document} class="flex items-center gap-3 px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="text-foreground truncate text-sm font-medium">{displayName(doc)}</p>
                <p class="text-muted-foreground mt-0.5 truncate text-xs">{metaLine(doc)}</p>
                {!doc.title && !doc.filename && (
                  <p class="text-muted-foreground/70 mt-0.5 truncate font-mono text-[11px]">
                    {doc.document.slice(0, 16)}
                  </p>
                )}
              </div>
              {doc.hiveId ? (
                <div class="flex shrink-0 items-center gap-2">
                  <a
                    href={`/books/${doc.hiveId}`}
                    class="text-primary truncate text-xs hover:underline"
                  >
                    {doc.bookTitle || "Linked"}
                  </a>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    onClick={() => startLink(doc.document, doc.title || doc.filename)}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  class="btn btn-sm shrink-0"
                  onClick={() => startLink(doc.document, doc.title || doc.filename)}
                >
                  Link to book
                </button>
              )}
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
        placeholder="Search for the matching book…"
      />
    </div>
  );
};
