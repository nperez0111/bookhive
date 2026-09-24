import type { Child, FC } from "hono/jsx";

/**
 * The one icon set — `Icon` (stroked) and `SolidIcon` (filled) wrappers plus
 * the named glyphs. Keep `fill-rule`/`clip-rule` hyphenated, not camelCase:
 * hono/jsx passes SVG attributes through verbatim, so React's `fillRule`/
 * `clipRule` spelling silently no-ops.
 */

type IconProps = {
  class?: string;
  /** 2 is lucide's weight, 1.5 heroicons'. */
  strokeWidth?: number | string;
};

/** A stroked icon: 24×24, no fill, `currentColor`, round caps and joins. */
export const Icon: FC<IconProps & { viewBox?: string; children?: Child }> = ({
  class: className,
  strokeWidth = 2,
  viewBox = "0 0 24 24",
  children,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class={className ?? "h-4 w-4"}
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** A filled icon: `currentColor`, no stroke. */
export const SolidIcon: FC<{ class?: string; viewBox?: string; children?: Child }> = ({
  class: className,
  viewBox = "0 0 24 24",
  children,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class={className ?? "h-4 w-4"}
    viewBox={viewBox}
    fill="currentColor"
    aria-hidden="true"
  >
    {children}
  </svg>
);

// --- Navigation & controls -------------------------------------------------

/** The one search icon — used in the navbar, palette, and explore filters. */
export const Search: FC<IconProps> = (props) => (
  <Icon {...props} strokeWidth={props.strokeWidth ?? 1.5}>
    <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
  </Icon>
);

export const ChevronDown: FC<{ class?: string }> = ({ class: className }) => (
  <SolidIcon class={className} viewBox="0 0 20 20">
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
    />
  </SolidIcon>
);

export const ChevronLeft: FC<{ class?: string }> = ({ class: className }) => (
  <SolidIcon class={className ?? "size-5"} viewBox="0 0 20 20">
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
    />
  </SolidIcon>
);

export const ChevronRight: FC<{ class?: string }> = ({ class: className }) => (
  <SolidIcon class={className ?? "size-5"} viewBox="0 0 20 20">
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
    />
  </SolidIcon>
);

export const ArrowLeft: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </Icon>
);

export const ArrowRight: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);

export const ExternalLink: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
);

export const Close: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Icon>
);

/** Stroked tick — lucide's, used on marketing checklists. */
export const Check: FC<IconProps> = (props) => (
  <Icon {...props} strokeWidth={props.strokeWidth ?? 3}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

/** Filled tick — the selected-item marker inside listbox menus. */
export const CheckSolid: FC<{ class?: string }> = ({ class: className }) => (
  <SolidIcon class={className} viewBox="0 0 20 20">
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
    />
  </SolidIcon>
);

/** Indeterminate loading ring. Callers add their own `animate-spin`. */
export const Spinner: FC<{ class?: string }> = ({ class: className }) => (
  <svg
    class={className ?? "h-4 w-4 animate-spin"}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
    <path
      class="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

// --- Books & people --------------------------------------------------------

/** Closed book — the "Own"/"Owned" toggle. */
export const Book: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
  </Icon>
);

/** Open book — the personal-library empty state and card placeholder. */
export const BookOpen: FC<IconProps> = (props) => (
  <Icon {...props} strokeWidth={props.strokeWidth ?? 1.5}>
    <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </Icon>
);

export const Folder: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
);

export const Users: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);

/** lucide's star, as an outline. */
const STAR =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

export const Star: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d={STAR} />
  </Icon>
);

export const StarSolid: FC<{ class?: string }> = ({ class: className }) => (
  <SolidIcon class={className}>
    <path d={STAR} />
  </SolidIcon>
);

// --- Sharing ---------------------------------------------------------------

export const Share: FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </Icon>
);

export const Copy: FC<IconProps> = (props) => (
  <Icon {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </Icon>
);

export const Bluesky: FC<{ class?: string }> = ({ class: className }) => (
  <SolidIcon class={className}>
    <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
  </SolidIcon>
);

export const Rss: FC<{ class?: string }> = ({ class: className }) => (
  <SolidIcon class={className ?? "h-4 w-4 text-orange-500"}>
    <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z" />
  </SolidIcon>
);
