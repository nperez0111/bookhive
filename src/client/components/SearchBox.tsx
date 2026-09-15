import { type FC } from "hono/jsx/dom";
import { Search } from "../../pages/components/icons";

export const SearchTrigger: FC<{ onOpen: () => void }> = ({ onOpen }) => {
  return (
    <button
      type="button"
      onClick={onOpen}
      class="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted cursor-pointer transition-colors"
      aria-label="Search books (Cmd+K)"
    >
      <Search class="size-4 shrink-0" />
      <span class="flex-1 text-left">Search books...</span>
      <kbd class="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
        <span class="text-[13px] leading-none">⌘</span>K
      </kbd>
    </button>
  );
};
