import type { FC } from "hono/jsx";
import { Script } from "../utils/script";
import { Bluesky, Copy, Rss, Share } from "./icons";

/**
 * The one share dropdown: Share on Bluesky / Copy link / Copy RSS feed.
 * `Script` stringifies its callback, so the body cannot close over an
 * instance id — handlers are delegated over data attributes instead, marked
 * as bound so rendering two menus on one page binds each exactly once.
 */

const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted";

export const ShareMenu: FC<{
  /** Where "Share on Bluesky" points. */
  blueskyHref: string;
  /** Site-relative path the Copy link button writes (origin is prepended client-side). */
  copyPath: string;
  /** Site-relative RSS path. */
  rssPath: string;
  /** Extra classes on the trigger. */
  buttonClass?: string;
  /** Extra classes on the positioning wrapper. */
  class?: string;
}> = ({ blueskyHref, copyPath, rssPath, buttonClass, class: className }) => (
  <div class={`relative ${className ?? ""}`} data-share-root>
    <button
      type="button"
      class={`btn btn-ghost min-h-10 min-w-10 ${buttonClass ?? ""}`}
      aria-haspopup="true"
      aria-expanded="false"
      data-share-trigger
    >
      <Share />
      Share
    </button>
    <div
      data-share-panel
      class="invisible absolute right-0 z-10 mt-1 w-48 rounded-lg bg-card opacity-0 shadow-lg ring-1 ring-border transition-[opacity,visibility] duration-100 ease-in-out"
    >
      <div class="p-1">
        <a href={blueskyHref} target="_blank" rel="noopener noreferrer" class={ITEM_CLASS}>
          <Bluesky />
          Share on Bluesky
        </a>
        <button type="button" class={ITEM_CLASS} data-copy-url={copyPath}>
          <Copy />
          <span data-copy-label="Copy link">Copy link</span>
        </button>
        <button type="button" class={ITEM_CLASS} data-copy-url={rssPath}>
          <Rss />
          <span data-copy-label="Copy RSS feed">Copy RSS feed</span>
        </button>
      </div>
    </div>
    <span data-share-feedback role="status" aria-live="polite" class="sr-only" />
    <ShareMenuScript />
  </div>
);

/** Self-contained because Script serializes this function into each rendered page. */
export function installShareMenus(document: Document) {
  const window = document.defaultView;
  if (!window) return;
  document
    .querySelectorAll<HTMLElement>("[data-share-root]:not([data-share-bound])")
    .forEach((root) => {
      root.setAttribute("data-share-bound", "");
      const btn = root.querySelector<HTMLButtonElement>("[data-share-trigger]");
      const menu = root.querySelector<HTMLElement>("[data-share-panel]");
      const feedback = root.querySelector<HTMLElement>("[data-share-feedback]");
      if (!btn || !menu) return;
      const setOpen = (open: boolean) => {
        menu.classList.toggle("invisible", !open);
        menu.classList.toggle("opacity-0", !open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      };
      btn.addEventListener("click", () => setOpen(menu.classList.contains("invisible")));
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || btn.getAttribute("aria-expanded") !== "true") return;
        event.preventDefault();
        setOpen(false);
        btn.focus();
      });
      document.addEventListener("click", (event) => {
        if (!root.contains(event.target as Node)) setOpen(false);
      });
      root.querySelectorAll<HTMLButtonElement>("[data-copy-url]").forEach((el) => {
        let resetTimer: number | undefined;
        el.addEventListener("click", async () => {
          const url = el.getAttribute("data-copy-url");
          const label = el.querySelector("[data-copy-label]");
          if (!url || !label || el.disabled) return;
          window.clearTimeout(resetTimer);
          const original = label.getAttribute("data-copy-label") || "Copy link";
          el.disabled = true;
          label.textContent = "Copying…";
          if (feedback) feedback.textContent = "";
          try {
            await window.navigator.clipboard.writeText(window.location.origin + url);
            label.textContent = "Copied!";
            if (feedback)
              feedback.textContent = `${original === "Copy RSS feed" ? "RSS feed" : "Link"} copied.`;
          } catch {
            label.textContent = "Copy failed";
            if (feedback) feedback.textContent = "Could not copy. Please try again.";
          } finally {
            el.disabled = false;
            resetTimer = window.setTimeout(() => {
              label.textContent = original;
            }, 1500);
          }
        });
      });
    });
}

/** Rendered by ShareMenu itself, so a caller cannot forget it. */
const ShareMenuScript: FC = () => <Script script={installShareMenus} />;
