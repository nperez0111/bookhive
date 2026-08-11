import { useEffect, useMemo, useRef, useState, type FC } from "hono/jsx/dom";

import {
  buildLibbyTitleUrl,
  findBookInLibrary,
  getLibraryPreferredKey,
  searchLibraryByName,
  type BookAvailability,
  type LibbyLibrary,
} from "../utils/libbyApi";
import {
  addLibrary as addLibraryToStorage,
  getCachedAvailability,
  getSelectedLibraries,
  removeLibrary,
  setCachedAvailability,
} from "../utils/libbyStorage";
import { useDebounce } from "./utils/useDebounce";

export type LibbyShelfBook = {
  hiveId: string;
  title: string;
  author: string;
  cover: string | null;
  isbn: string | null;
  isbn13: string | null;
  olWorkId: string | null;
};

type RowState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; data: BookAvailability }
  | { kind: "error"; message: string };

const CONCURRENT_LOOKUPS = 4;

export const LibbyShelf: FC<{ books: LibbyShelfBook[] }> = ({ books }) => {
  const [libraries, setLibraries] = useState<LibbyLibrary[]>(() => getSelectedLibraries());
  const [activeLibraryId, setActiveLibraryId] = useState<number | null>(
    () => getSelectedLibraries()[0]?.id ?? null,
  );
  const [resolvedKeys, setResolvedKeys] = useState<Record<number, string>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const lookupRef = useRef<{ running: number; queue: Array<() => Promise<void>> }>({
    running: 0,
    queue: [],
  });

  const activeLibrary = useMemo(
    () => libraries.find((l) => l.id === activeLibraryId) ?? null,
    [libraries, activeLibraryId],
  );
  const activeKey = activeLibrary
    ? (resolvedKeys[activeLibrary.id] ?? activeLibrary.preferredKey ?? null)
    : null;

  // Resolve preferredKey for any selected library that doesn't already have one.
  useEffect(() => {
    let cancelled = false;
    for (const lib of libraries) {
      if (resolvedKeys[lib.id] || lib.preferredKey) continue;
      void getLibraryPreferredKey(lib.fulfillmentId)
        .then((key) => {
          if (cancelled) return;
          setResolvedKeys((prev) => ({ ...prev, [lib.id]: key }));
        })
        .catch(() => {
          if (cancelled) return;
          setResolvedKeys((prev) => ({ ...prev, [lib.id]: lib.fulfillmentId }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [libraries, resolvedKeys]);

  // Hydrate cached availability whenever the active library changes.
  useEffect(() => {
    if (!activeKey) {
      setRowState({});
      return;
    }
    const next: Record<string, RowState> = {};
    for (const book of books) {
      const cached = getCachedAvailability(activeKey, book.hiveId);
      next[book.hiveId] = cached ? { kind: "result", data: cached } : { kind: "idle" };
    }
    setRowState(next);
  }, [activeKey, books]);

  function runQueue() {
    const lookup = lookupRef.current;
    if (!lookup) return;
    while (lookup.running < CONCURRENT_LOOKUPS && lookup.queue.length > 0) {
      const next = lookup.queue.shift();
      if (!next) break;
      lookup.running += 1;
      void next().finally(() => {
        lookup.running -= 1;
        runQueue();
      });
    }
  }

  function lookupOne(libraryKey: string, book: LibbyShelfBook) {
    setRowState((prev) => ({ ...prev, [book.hiveId]: { kind: "checking" } }));
    const lookup = lookupRef.current;
    if (!lookup) return;
    lookup.queue.push(async () => {
      try {
        const result = await findBookInLibrary(libraryKey, book.title, book.author, {
          primaryIsbn: book.isbn13 || book.isbn,
        });
        setCachedAvailability(libraryKey, book.hiveId, result);
        setRowState((prev) => ({ ...prev, [book.hiveId]: { kind: "result", data: result } }));
      } catch (err) {
        setRowState((prev) => ({
          ...prev,
          [book.hiveId]: {
            kind: "error",
            message: err instanceof Error ? err.message : "lookup failed",
          },
        }));
      }
    });
    runQueue();
  }

  function checkAll() {
    if (!activeKey) return;
    for (const book of books) {
      const state = rowState[book.hiveId];
      if (!state || state.kind === "idle" || state.kind === "error") {
        lookupOne(activeKey, book);
      }
    }
  }

  const onLibraryAdded = (lib: LibbyLibrary) => {
    addLibraryToStorage(lib);
    setLibraries(getSelectedLibraries());
    setActiveLibraryId(lib.id);
  };

  const onLibraryRemoved = (id: number) => {
    removeLibrary(id);
    const next = getSelectedLibraries();
    setLibraries(next);
    if (activeLibraryId === id) {
      setActiveLibraryId(next[0]?.id ?? null);
    }
  };

  return (
    <div class="space-y-6">
      <LibraryPicker
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onSelectLibrary={setActiveLibraryId}
        onAddLibrary={onLibraryAdded}
        onRemoveLibrary={onLibraryRemoved}
      />

      {activeLibrary && (
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm text-muted-foreground">
            Checking <span class="font-medium text-foreground">{activeLibrary.name}</span>
          </p>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={checkAll}
            disabled={!activeKey}
          >
            Check all books
          </button>
        </div>
      )}

      <ul class="divide-y divide-border">
        {books.map((book) => (
          <li key={book.hiveId} class="flex items-start gap-3 py-3">
            <div class="h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-muted shadow-sm">
              {book.cover ? (
                <img src={book.cover} alt="" class="h-full w-full object-cover" />
              ) : null}
            </div>
            <div class="min-w-0 flex-1">
              <a
                href={`/books/${book.hiveId}`}
                class="line-clamp-1 text-sm font-medium text-foreground hover:underline"
              >
                {book.title}
              </a>
              <p class="line-clamp-1 text-xs text-muted-foreground">{book.author}</p>
              <div class="mt-2">
                <BadgeForState
                  state={rowState[book.hiveId] ?? { kind: "idle" }}
                  libraryReady={Boolean(activeKey)}
                  onCheck={() => activeKey && lookupOne(activeKey, book)}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

const LibraryPicker: FC<{
  libraries: LibbyLibrary[];
  activeLibraryId: number | null;
  onSelectLibrary: (id: number) => void;
  onAddLibrary: (lib: LibbyLibrary) => void;
  onRemoveLibrary: (id: number) => void;
}> = ({ libraries, activeLibraryId, onSelectLibrary, onAddLibrary, onRemoveLibrary }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibbyLibrary[]>([]);
  const [searching, setSearching] = useState(false);
  const debounced = useDebounce(query, 250);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void searchLibraryByName(debounced)
      .then((libs) => {
        if (cancelled) return;
        setResults(libs.slice(0, 20));
      })
      .catch(() => {
        if (cancelled) return;
        setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <div class="space-y-3">
      <label class="block text-sm font-medium text-foreground">Your library</label>

      {libraries.length > 0 && (
        <div class="flex flex-wrap gap-2">
          {libraries.map((lib) => (
            <button
              key={lib.id}
              type="button"
              class={`rounded-full border px-3 py-1 text-xs ${
                lib.id === activeLibraryId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted"
              }`}
              onClick={() => onSelectLibrary(lib.id)}
            >
              {lib.name}
              <span
                role="button"
                aria-label={`Remove ${lib.name}`}
                class="ml-2 opacity-70 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveLibrary(lib.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        placeholder="Search for a library — try your city or system name"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />

      {results.length > 0 && (
        <ul class="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
          {results.map((lib) => (
            <li key={lib.id}>
              <button
                type="button"
                class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onAddLibrary(lib);
                  setQuery("");
                  setResults([]);
                }}
              >
                <span class="text-foreground">{lib.name}</span>
                {lib.type ? <span class="text-xs text-muted-foreground">{lib.type}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {searching && results.length === 0 && (
        <p class="text-xs text-muted-foreground">Searching libraries…</p>
      )}
    </div>
  );
};

const BadgeForState: FC<{
  state: RowState;
  libraryReady: boolean;
  onCheck: () => void;
}> = ({ state, libraryReady, onCheck }) => {
  if (!libraryReady) {
    return <span class="text-xs text-muted-foreground">Pick a library to check.</span>;
  }
  if (state.kind === "idle") {
    return (
      <button
        type="button"
        class="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        onClick={onCheck}
      >
        Check Libby
      </button>
    );
  }
  if (state.kind === "checking") {
    return <span class="text-xs text-muted-foreground">Checking…</span>;
  }
  if (state.kind === "error") {
    return (
      <button
        type="button"
        class="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        onClick={onCheck}
        title={state.message}
      >
        Try again
      </button>
    );
  }

  const top = state.data.results[0];
  if (!top) {
    return <span class="text-xs text-muted-foreground">Not at this library.</span>;
  }

  const a = top.availability;
  const url = buildLibbyTitleUrl(top.libraryKey, top.mediaItem.id);

  if (a.copiesAvailable > 0) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
      >
        Available now · {a.copiesAvailable} copies
      </a>
    );
  }

  if (a.copiesOwned > 0) {
    const wait =
      a.estimatedWaitDays != null && a.estimatedWaitDays > 0
        ? `, ~${a.estimatedWaitDays}d wait`
        : "";
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
      >
        {a.numberOfHolds} hold{a.numberOfHolds === 1 ? "" : "s"}
        {wait}
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/80"
    >
      Listed but unavailable
    </a>
  );
};
