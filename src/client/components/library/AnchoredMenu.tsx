import type { FC, PropsWithChildren } from "hono/jsx/dom";

/**
 * A menu that opens, closes, light-dismisses and positions itself with no
 * JavaScript: `popovertarget` drives the open/close, the `popover` attribute
 * puts it in the top layer (so no ancestor's `overflow: hidden` can clip it),
 * and the CSS anchor positioning API tethers it to its trigger. See
 * `.anchored-menu` in `src/index.css`.
 *
 * `id` must be unique on the page — it is both the popover id and the seed for
 * the anchor ident, so it has to be a valid custom-ident suffix.
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
  const anchorName = `--anchor-${id}`;

  return (
    <>
      <button
        type="button"
        popovertarget={id}
        style={`anchor-name: ${anchorName}`}
        class={
          triggerClass ??
          "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]"
        }
        aria-label={label}
      >
        {trigger ?? <MoreIcon />}
      </button>

      <div id={id} popover="auto" class="anchored-menu" style={`position-anchor: ${anchorName}`}>
        <div class={`${width} rounded-md border border-border bg-popover py-1 text-left shadow-md`}>
          {children}
        </div>
      </div>
    </>
  );
};

/**
 * An item inside an `AnchoredMenu`. `popovertargetaction="hide"` closes the
 * menu declaratively as the click runs, so no open/close state is needed.
 * Omit `menuId` for items that should leave the menu open (e.g. a checkbox
 * list you want to toggle several times).
 */
export const MenuItem: FC<
  PropsWithChildren<{
    menuId?: string;
    onClick?: () => void;
    danger?: boolean;
  }>
> = ({ menuId, onClick, danger, children }) => (
  <button
    type="button"
    {...(menuId ? { popovertarget: menuId, popovertargetaction: "hide" } : {})}
    onClick={onClick}
    class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted ${
      danger ? "text-destructive" : "text-foreground"
    }`}
  >
    {children}
  </button>
);

/** A nested confirmation step, itself a popover anchored to its own trigger. */
export const MenuConfirm: FC<{
  id: string;
  /** Label of the item that opens the confirmation. */
  label: string;
  /** Copy explaining what confirming does. */
  description: string;
  confirmLabel: string;
  /** The menu to close once confirmed. */
  menuId: string;
  onConfirm: () => void;
}> = ({ id, label, description, confirmLabel, menuId, onConfirm }) => {
  const anchorName = `--anchor-${id}`;

  return (
    <>
      <button
        type="button"
        popovertarget={id}
        style={`anchor-name: ${anchorName}`}
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted"
      >
        {label}
      </button>

      {/* A descendant of the parent popover, so opening it nests rather than
          light-dismissing the menu underneath. */}
      <div id={id} popover="auto" class="anchored-menu" style={`position-anchor: ${anchorName}`}>
        <div class="w-56 rounded-md border border-border bg-popover p-3 shadow-md">
          <p class="text-xs text-muted-foreground">{description}</p>
          <div class="mt-2 flex items-center gap-3">
            <button
              type="button"
              popovertarget={menuId}
              popovertargetaction="hide"
              class="text-xs font-medium text-destructive hover:underline"
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
            <button
              type="button"
              popovertarget={id}
              popovertargetaction="hide"
              class="text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export const MoreIcon: FC = () => (
  <svg class="size-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="13" cy="8" r="1.5" />
  </svg>
);
