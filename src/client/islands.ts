/**
 * The one island mount. Six islands used to be bootstrapped six different
 * ways, with a malformed `data-*` attribute or a chunk 404 free to throw out
 * of the shared `DOMContentLoaded` listener and skip every island registered
 * after it. The failure policy here is uniform and deliberately quiet: an
 * island that cannot mount leaves the server-rendered markup in place, and
 * nothing here throws into the caller.
 */

/** Mounts an island into `el`. Props come from the element's `data-*`. */
export type Mount<P> = (el: HTMLElement, props: P) => void;

/**
 * Read a JSON `data-*` attribute. `fallback` covers both an absent and a
 * malformed attribute — an island whose props are unreadable is skipped, not
 * handed `undefined`. `validate` exists because parsing successfully isn't
 * the same as being usable: `data-books="null"` parses fine and then throws
 * inside `LibraryTable`'s `[...books].sort()` at render time.
 */
export function jsonAttr<P>(
  name: string,
  fallback: P,
  validate?: (value: unknown) => boolean,
): (el: HTMLElement) => P {
  return (el) => {
    const raw = el.dataset[name];
    if (!raw) return fallback;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`[island] could not parse data-${name}:`, err);
      return fallback;
    }
    if (validate && !validate(parsed)) {
      console.error(`[island] data-${name} parsed but failed validation`);
      return fallback;
    }
    return parsed as P;
  };
}

/** Read a boolean `data-*` attribute. Absent or anything but `"true"` is false. */
export function boolAttr(name: string): (el: HTMLElement) => boolean {
  return (el) => el.dataset[name] === "true";
}

export type Island = {
  /** Mount now. Safe to call more than once; only the first mounts. */
  run: () => void;
  /** Present in the DOM — i.e. this page renders the island at all. */
  readonly present: boolean;
};

export function island<P = void>({
  id,
  props,
  load,
  lazy = false,
}: {
  /** Mount point id, without the `#`. Absent from the page → no-op. */
  id: string;
  /** Derive props from the mount element. Omit for islands that take none. */
  props?: (el: HTMLElement) => P;
  /** Chunk loader. A rejection is logged, never rethrown. */
  load: () => Promise<Mount<P>>;
  /** Defer the import until `run()` — for chunks only fetched on interaction. */
  lazy?: boolean;
}): Island {
  const el = document.getElementById(id);
  let started = false;

  const run = () => {
    if (!el || started) return;
    started = true;
    const value = (props ? props(el) : undefined) as P;
    load()
      .then((mount) => mount(el, value))
      .catch((err) => console.error(`[island] ${id} failed to load:`, err));
  };

  if (!lazy) run();
  return { run, present: Boolean(el) };
}
