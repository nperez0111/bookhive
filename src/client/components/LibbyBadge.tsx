import { useEffect, useState, type FC } from "hono/jsx/dom";

import {
  buildLibbyTitleUrl,
  findBookInLibrary,
  getLibraryPreferredKey,
  type BookAvailability,
} from "../utils/libbyApi";
import {
  getCachedAvailability,
  getSelectedLibraries,
  setCachedAvailability,
} from "../utils/libbyStorage";

export type LibbyBadgeProps = {
  hiveId: string;
  title: string;
  author: string;
  isbn: string | null;
  isbn13: string | null;
};

type State =
  | { kind: "no-library" }
  | { kind: "checking" }
  | { kind: "result"; data: BookAvailability; libraryKey: string }
  | { kind: "error" };

/**
 * Compact "available now" pill that hydrates next to a want-to-read row.
 * Reads the user's selected library out of `localStorage` (set on /libby);
 * if none is configured the badge stays invisible to avoid noise on the
 * profile shelf for users who haven't opted in.
 */
export const LibbyBadge: FC<LibbyBadgeProps> = ({ hiveId, title, author, isbn, isbn13 }) => {
  const [state, setState] = useState<State>({ kind: "no-library" });

  useEffect(() => {
    const libs = getSelectedLibraries();
    const active = libs[0];
    if (!active) {
      setState({ kind: "no-library" });
      return;
    }

    let cancelled = false;
    void (async () => {
      let libraryKey = active.preferredKey;
      try {
        if (!libraryKey) {
          libraryKey = await getLibraryPreferredKey(active.fulfillmentId);
        }
      } catch {
        libraryKey = active.fulfillmentId;
      }
      if (cancelled) return;

      const cached = getCachedAvailability(libraryKey, hiveId);
      if (cached) {
        setState({ kind: "result", data: cached, libraryKey });
        return;
      }

      setState({ kind: "checking" });
      try {
        const data = await findBookInLibrary(libraryKey, title, author, {
          primaryIsbn: isbn13 || isbn,
        });
        if (cancelled) return;
        setCachedAvailability(libraryKey, hiveId, data);
        setState({ kind: "result", data, libraryKey });
      } catch {
        if (cancelled) return;
        setState({ kind: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hiveId, title, author, isbn, isbn13]);

  if (state.kind === "no-library") return null;
  if (state.kind === "checking") {
    return <span class="text-xs text-muted-foreground">Checking Libby…</span>;
  }
  if (state.kind === "error") return null;

  const top = state.data.results[0];
  if (!top) return null;

  const a = top.availability;
  const url = buildLibbyTitleUrl(top.libraryKey, top.mediaItem.id);

  if (a.copiesAvailable > 0) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
        title={`Available now at ${state.libraryKey}`}
      >
        Libby · available
      </a>
    );
  }

  if (a.copiesOwned > 0) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
        title={`${a.numberOfHolds} holds at ${state.libraryKey}`}
      >
        Libby · {a.numberOfHolds} hold{a.numberOfHolds === 1 ? "" : "s"}
      </a>
    );
  }

  return null;
};
