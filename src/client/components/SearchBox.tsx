import { type FC } from "hono/jsx/dom";

export const SearchTrigger: FC<{ onOpen: () => void }> = ({ onOpen }) => {
  return (
    <button
      type="button"
      onClick={onOpen}
      class="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted cursor-pointer transition-colors"
      aria-label="Search books (Cmd+K)"
    >
      <svg
        class="size-4 shrink-0"
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
      <span class="flex-1 text-left">Search books...</span>
      <kbd class="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
        ⌘K
      </kbd>
    </button>
  );
};
