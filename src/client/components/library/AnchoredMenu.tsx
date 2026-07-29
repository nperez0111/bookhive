import type { FC, PropsWithChildren } from "hono/jsx/dom";

/*
 * Why this is a checkbox and not the Popover API.
 *
 * An element with an open `popover` is in the top layer, and the top layer
 * detaches it from the containing-block chain entirely: `offsetParent` is null
 * and `position: static | relative | absolute | fixed` all resolve against the
 * initial containing block (measured, not assumed — `static` and `relative` are
 * even coerced to a computed `position: absolute`). So the *only* way to tether
 * an open popover to its trigger is the CSS anchor positioning API, which is
 * Chromium-only; Firefox and Safari fell back to a viewport-centred sheet.
 *
 * So the popover is gone and this is the plain `absolute`-inside-`relative`
 * placement every other menu in the app uses (navbar user menu, book status
 * dropdown, share menus). Everything popover gave us for free is replaced
 * without JavaScript:
 *
 *   - open/close   → a `peer` checkbox + `peer-checked:` variants
 *   - light dismiss → a viewport-filling `<button type="reset">` behind the panel
 *   - item closes menu → `<button type="reset">`, which is why the whole menu is
 *     wrapped in a `<form>`: reset returns every checkbox in it to unchecked,
 *     closing the menu *and* any nested confirmation in one declarative step.
 *
 * The trigger is a visually hidden but still focusable checkbox plus a `<label>`,
 * so the control stays keyboard operable (Tab to it, Space to open).
 */

const DEFAULT_TRIGGER_CLASS =
  "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]";

/** Focus ring + "stay visible while open", appended to whatever `triggerClass` gives us. */
const TRIGGER_STATE_CLASS =
  "peer-checked:bg-muted peer-checked:text-foreground peer-checked:opacity-100 peer-focus-visible:opacity-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary";

/** Shared show/hide transition for a panel driven by a preceding `peer` checkbox. */
const PANEL_CLASS =
  "invisible absolute top-full right-0 z-50 mt-1 opacity-0 transition-[opacity,visibility] duration-100 ease-out peer-checked:visible peer-checked:opacity-100";

/**
 * A dropdown menu tethered to its trigger with no JavaScript.
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
> = ({ id, label, triggerClass, trigger, width = "w-48", children }) => (
  // The form exists purely so `type="reset"` buttons inside it can close the
  // menu. `method="dialog"` with no ancestor <dialog> makes submission a no-op
  // (verified: even a forced `requestSubmit()` does not navigate), so the form
  // can never take the page away — no JS guard needed.
  <form method="dialog" class="relative inline-flex">
    {/* Visually hidden, but still in the tab order and Space-toggleable. */}
    <input type="checkbox" id={id} aria-label={label} class="peer sr-only" />

    <label for={id} class={`${triggerClass ?? DEFAULT_TRIGGER_CLASS} ${TRIGGER_STATE_CLASS}`}>
      {trigger ?? <MoreIcon />}
    </label>

    {/* Light dismiss. Fills the viewport behind the panel; resetting the form
        closes this menu and any nested confirmation at once. `fixed` is safe
        here only because no ancestor sets a transform/filter — see the note on
        the action layer in PersonalBookCard. */}
    <button
      type="reset"
      tabIndex={-1}
      aria-hidden="true"
      class="invisible fixed inset-0 z-40 cursor-default peer-checked:visible"
    />

    <div class={PANEL_CLASS}>
      <div class={`${width} rounded-md border border-border bg-popover py-1 text-left shadow-md`}>
        {children}
      </div>
    </div>
  </form>
);

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

    <div class={PANEL_CLASS}>
      <div class="w-56 rounded-md border border-border bg-popover p-3 shadow-md">
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
