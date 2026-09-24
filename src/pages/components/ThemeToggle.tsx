import type { FC } from "hono/jsx";
import { Script } from "../utils/script";

/**
 * The one dark-mode toggle, including the `<meta name="theme-color">` update.
 * The colour values must match `layout.tsx`'s pre-paint set exactly — they
 * can't be shared by import since `Script` stringifies its callback, so
 * they're literals in both places and `src/pages/layout.test.tsx` pins them
 * equal.
 */

/** `--background` light / dark, from `src/index.css`. */
export const THEME_COLOR = { light: "#f9eabc", dark: "#422006" } as const;

const SunPath =
  "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z";
const MoonPath =
  "M21.752 15.752A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.248z";

const ThemeIcon: FC<{ path: string; class: string }> = ({ path, class: className }) => (
  <svg class={className} fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d={path} />
  </svg>
);

/**
 * `class` positions it; behaviour comes from `ThemeToggleScript`, which
 * delegates over `.theme-toggle` so any number of these can be on a page.
 * Deliberately carries no `id` — that would duplicate across instances.
 */
export const ThemeToggle: FC<{
  class?: string;
  /** Base icon classes; the drawer variant uses `size-4 shrink-0`. */
  iconClass?: string;
  /** Visible label, for the drawer variant where the icon sits in a text row. */
  label?: string;
}> = ({ class: className, iconClass = "size-5", label }) => (
  <button
    type="button"
    class={`theme-toggle ${className ?? "flex size-10 items-center justify-center rounded-md text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]"}`}
    aria-label="Toggle dark mode"
    title="Toggle dark mode"
  >
    <ThemeIcon path={MoonPath} class={`${iconClass} dark:hidden`} />
    <ThemeIcon path={SunPath} class={`hidden ${iconClass} dark:block`} />
    {label}
  </button>
);

/** Render once per page that renders any `ThemeToggle`. */
export const ThemeToggleScript: FC = () => (
  <Script
    script={(document) => {
      const updateThemeColor = () => {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
          meta.setAttribute(
            "content",
            document.documentElement.classList.contains("dark") ? "#422006" : "#f9eabc",
          );
        }
      };
      updateThemeColor();
      document.querySelectorAll(".theme-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const html = document.documentElement;
          const isDark = html.classList.toggle("dark");
          localStorage.setItem("theme", isDark ? "dark" : "light");
          updateThemeColor();
        });
      });
    }}
  />
);
