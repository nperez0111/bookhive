import type { Child, FC } from "hono/jsx";
import { Search } from "./icons";
import { formatCount } from "../../lib/formatCount";

/**
 * **The one** A-to-Z directory listing: a filter box, an empty message, a
 * three-column card of rows, and the client-side filter that hides rows as you
 * type. `/explore/genres` and `/explore/authors` each used to carry a
 * byte-for-byte copy of this that had drifted in tap target size, hover
 * transitions and the inline filter script.
 *
 * The script is delegated over data attributes rather than ids, the same way
 * `ShareMenu` is and for the same reason: `Script` stringifies its callback, so
 * it cannot close over per-instance names. One copy covers any number of
 * directories on a page.
 */
export const FilterableDirectory: FC<{
  /** Placeholder for the filter input. */
  placeholder: string;
  /** Accessible name for the filter input. */
  label: string;
  /** Shown when the filter matches nothing. */
  emptyMessage: string;
  /** `DirectoryRow`s. */
  children?: Child;
}> = ({ placeholder, label, emptyMessage, children }) => (
  <section data-directory>
    <div class="relative mb-4">
      <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <input
        type="search"
        placeholder={placeholder}
        class="input w-full pl-9"
        aria-label={label}
        autocomplete="off"
        data-directory-input
      />
    </div>

    <p class="text-muted-foreground hidden py-8 text-center text-sm" data-directory-empty>
      {emptyMessage}
    </p>

    <div class="card overflow-hidden">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  </section>
);

export const DirectoryRow: FC<{
  href: string;
  /** What the filter matches against; lowercased here so callers can't forget. */
  filter: string;
  label: string;
  count: number;
  /** Leading glyph (the genre emoji). */
  leading?: Child;
  /** Extra classes on the label — `/explore/genres` names its view transition. */
  labelClass?: string;
  style?: string;
}> = ({ href, filter, label, count, leading, labelClass, style }) => (
  <a
    href={href}
    data-filter={filter.toLowerCase()}
    class="group border-border hover:bg-muted/60 flex min-h-10 items-center gap-3 border-b px-4 py-3 transition-[background-color,color] duration-150 active:scale-[0.98]"
    style={style}
  >
    {leading && (
      <span
        class="flex w-7 shrink-0 items-center justify-center text-lg leading-none"
        aria-hidden="true"
      >
        {leading}
      </span>
    )}
    <span
      class={`text-foreground group-hover:text-primary flex-1 truncate text-sm font-medium transition-colors duration-150 ${labelClass ?? ""}`}
    >
      {label}
    </span>
    <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{formatCount(count)}</span>
  </a>
);

/**
 * Rendered once per page that uses `FilterableDirectory`. Plain `<script>`
 * rather than `Script` because it must run before hydration (these pages ship
 * no island) and has nothing to close over.
 */
export const FilterableDirectoryScript: FC = () => (
  <script
    dangerouslySetInnerHTML={{
      __html: `(function(){
  document.querySelectorAll('[data-directory]').forEach(function(root){
    var input=root.querySelector('[data-directory-input]');
    var empty=root.querySelector('[data-directory-empty]');
    if(!input||!empty)return;
    input.addEventListener('input',function(){
      var q=this.value.toLowerCase().trim();
      var visible=0;
      root.querySelectorAll('[data-filter]').forEach(function(el){
        var match=!q||el.getAttribute('data-filter').includes(q);
        el.style.display=match?'':'none';
        if(match)visible++;
      });
      empty.classList.toggle('hidden',visible>0);
    });
  });
})();`,
    }}
  />
);
