import { useEffect, useRef, type FC, type PropsWithChildren } from "hono/jsx/dom";

// Plain `absolute`-inside-`relative` placement, not the Popover API — a popover's top-layer breaks anchoring outside Chromium's CSS anchor positioning; both were tried and reverted.

const DEFAULT_TRIGGER_CLASS =
  "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]";

/** Focus ring + "stay visible while open", appended to whatever `triggerClass` gives us. */
const TRIGGER_STATE_CLASS =
  "peer-checked:bg-muted peer-checked:text-foreground peer-checked:opacity-100 peer-focus-visible:opacity-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary";

/** Shared show/hide transition for a panel driven by a preceding `peer` checkbox. */
const PANEL_CLASS =
  "invisible absolute top-full right-0 z-50 mt-1 opacity-0 transition-[opacity,visibility] duration-100 ease-out peer-checked:visible peer-checked:opacity-100";

/**
 * Checkbox-driven dropdown; JavaScript only keeps panels inside the content column.
 *
 * `id` must be unique on the page — it is the id of the checkbox that holds the
 * open state, and the `for` target of the trigger label.
 */
export const AnchoredMenu: FC<
  PropsWithChildren<{
    id: string;
    /** Accessible name for the trigger. */
    label: string;
    triggerClass?: string;
    /** Trigger contents; defaults to a horizontal ellipsis. */
    trigger?: unknown;
    width?: string;
  }>
> = ({ id, label, triggerClass, trigger, width = "w-48", children }) => {
  const formRef = useRef<HTMLFormElement | null>(null);
  const positionPanels = () => {
    const form = formRef.current;
    if (!form) return;
    const main = form.closest("main")?.getBoundingClientRect();
    const left = Math.max(16, main ? main.left + 16 : 0);
    const right = Math.min(
      document.documentElement.clientWidth - 16,
      main ? main.right - 16 : Infinity,
    );
    // Parent-first: moving the menu changes the confirmation's containing block.
    for (const panel of form.querySelectorAll<HTMLElement>("[data-menu-panel]")) {
      panel.style.maxWidth = `${Math.max(0, right - left)}px`;
      panel.style.right = "0px";
      const rect = panel.getBoundingClientRect();
      const x = Math.max(left, Math.min(rect.left, right - rect.width));
      panel.style.right = `${rect.left - x}px`;
    }
  };
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const observer = new ResizeObserver(positionPanels);
    observer.observe(form.closest("main") ?? document.documentElement);
    window.addEventListener("resize", positionPanels);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionPanels);
    };
  }, []);
  return (
    // The form exists purely so `type="reset"` buttons inside it can close the menu; `method="dialog"` with no ancestor <dialog> makes submission a no-op, so the form can never take the page away.
    <form ref={formRef} method="dialog" class="relative inline-flex" onChange={positionPanels}>
      {/* Visually hidden, but still in the tab order and Space-toggleable. */}
      <input type="checkbox" id={id} aria-label={label} class="peer sr-only" />

      <label for={id} class={`${triggerClass ?? DEFAULT_TRIGGER_CLASS} ${TRIGGER_STATE_CLASS}`}>
        {trigger ?? <MoreIcon />}
      </label>

      {/* Light dismiss; resetting the form closes this menu and any nested confirmation. `fixed` is safe here only because no ancestor sets a transform/filter — see PersonalBookCard's action-layer note. */}
      <button
        type="reset"
        tabIndex={-1}
        aria-hidden="true"
        class="invisible fixed inset-0 z-40 cursor-default peer-checked:visible"
      />

      <div data-menu-panel class={PANEL_CLASS}>
        <div
          class={`${width} max-w-full rounded-md border border-border bg-popover py-1 text-left shadow-md`}
        >
          {children}
        </div>
      </div>
    </form>
  );
};

/**
 * An item inside an `AnchoredMenu`. Passing `menuId` makes it a reset button, so
 * clicking it closes the menu as the click runs — no open/close state needed.
 * Omit `menuId` for items that should leave the menu open (e.g. a checkbox list
 * you want to toggle several times).
 */
export const MenuItem: FC<
  PropsWithChildren<{
    /** Presence means "close the menu on click". The value is unused. */
    menuId?: string;
    onClick?: () => void;
    danger?: boolean;
  }>
> = ({ menuId, onClick, danger, children }) => (
  <button
    type={menuId ? "reset" : "button"}
    onClick={onClick}
    class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted ${
      danger ? "text-destructive" : "text-foreground"
    }`}
  >
    {children}
  </button>
);

/**
 * A nested confirmation step. Its own `peer` checkbox, so opening it leaves the
 * surrounding menu untouched; both buttons reset the form, which closes the
 * confirmation and the menu together.
 */
export const MenuConfirm: FC<{
  id: string;
  /** Label of the item that opens the confirmation. */
  label: string;
  /** Copy explaining what confirming does. */
  description: string;
  confirmLabel: string;
  /** Retained for call-site stability; the form reset closes the menu. */
  menuId?: string;
  onConfirm: () => void;
}> = ({ id, label, description, confirmLabel, onConfirm }) => (
  <div class="relative">
    <input type="checkbox" id={id} class="peer sr-only" />

    <label
      for={id}
      class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted peer-checked:bg-muted peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-primary"
    >
      {label}
    </label>

    <div data-menu-panel class={PANEL_CLASS}>
      <div class="w-56 max-w-full rounded-md border border-border bg-popover p-3 shadow-md">
        <p class="text-xs text-muted-foreground">{description}</p>
        <div class="mt-2 flex items-center gap-3">
          <button
            type="reset"
            class="text-xs font-medium text-destructive hover:underline"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="reset" class="text-xs text-muted-foreground hover:underline">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
);

export const MoreIcon: FC = () => (
  <svg class="size-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="13" cy="8" r="1.5" />
  </svg>
);
