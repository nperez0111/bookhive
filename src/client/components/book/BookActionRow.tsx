import { useEffect, useRef, useState, useSyncExternalStore, type FC } from "hono/jsx/dom";

import { STATUS, type UserBookStore } from "./userBookStore";

const STATUS_OPTIONS = [
  { value: STATUS.FINISHED, label: "Read" },
  { value: STATUS.READING, label: "Reading" },
  { value: STATUS.WANT_TO_READ, label: "Want to Read" },
  { value: STATUS.ABANDONED, label: "Abandoned" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  [STATUS.FINISHED]: "Read",
  [STATUS.READING]: "Reading",
  [STATUS.WANT_TO_READ]: "Want to Read",
  [STATUS.ABANDONED]: "Abandoned",
};

export function useUserBook(store: UserBookStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const pillClass = (active: boolean) =>
  `cursor-pointer rounded-lg text-sm font-semibold shadow-sm transition-[background-color,scale,opacity] duration-150 active:scale-[0.96] focus:ring-2 focus:ring-primary focus:outline-none ${
    active
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "bg-accent text-accent-foreground hover:bg-accent/80"
  }`;

export const BookActionRow: FC<{ store: UserBookStore }> = ({ store }) => {
  const { view, pending } = useUserBook(store);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const status = view?.status ?? null;
  const busy = pending > 0;

  return (
    <>
      <div class="relative" ref={rootRef}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open ? "true" : "false"}
          aria-busy={busy ? "true" : "false"}
          class={`${pillClass(!!status)} px-4 py-2 ${busy ? "opacity-80" : ""}`}
          onClick={() => setOpen((o) => !o)}
        >
          <span class="flex items-center gap-1.5 capitalize">
            <span>{(status && STATUS_LABEL[status]) || status || "Want to Read"}</span>
            <svg
              class="h-4 w-4 opacity-70"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </button>
        <div
          role="listbox"
          class={`absolute z-10 mt-1 w-48 rounded-lg bg-card shadow-lg ring-1 ring-border transition-[opacity,visibility] duration-100 ease-in-out ${
            open ? "visible opacity-100" : "invisible opacity-0"
          }`}
        >
          <div class="p-1">
            {STATUS_OPTIONS.map((option) => {
              const selected = status === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected ? "true" : "false"}
                  class={`relative my-0.5 w-full cursor-pointer rounded-[4px] px-3 py-2 text-left text-sm ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                  }`}
                  onClick={() => {
                    setOpen(false);
                    if (!selected) void store.update({ status: option.value });
                  }}
                >
                  <span class="block truncate">{option.label}</span>
                  {selected && (
                    <span class="absolute inset-y-0 right-2 flex items-center" aria-hidden="true">
                      <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-pressed={view?.owned ? "true" : "false"}
        class={`${pillClass(!!view?.owned)} px-3 py-2`}
        onClick={() => void store.update({ owned: !view?.owned })}
      >
        <span class="flex items-center gap-1.5">
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
          {view?.owned ? "Owned" : "Own"}
        </span>
      </button>
    </>
  );
};
