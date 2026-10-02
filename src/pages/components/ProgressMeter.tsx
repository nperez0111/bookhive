import type { FC } from "hono/jsx";

/**
 * The one filled-track meter — keeps the width transition and the
 * "finished is green" rule consistent everywhere. `barClass` overrides the
 * colour for meters that aren't reading progress (storage, genre chart).
 * `percent` is clamped, so a caller may pass a raw ratio without guarding it.
 */
export const ProgressMeter: FC<{
  /** 0–100. Clamped. */
  percent: number;
  /** `sm` is h-1.5 (dense lists), `md` is h-2 (detail views). */
  size?: "sm" | "md";
  /** Extra classes on the rail — margins, `flex-1`. */
  class?: string;
  /** Overrides the finished/in-progress colour. */
  barClass?: string;
  /** Floor on the rendered width, so a small non-zero value stays visible. */
  minWidth?: number;
  /** Set to expose the meter to assistive tech as a `progressbar`. */
  label?: string;
}> = ({ percent, size = "md", class: className, barClass, minWidth = 0, label }) => {
  const value = Math.max(0, Math.min(100, percent));
  const width = Math.max(value, minWidth);
  return (
    <div
      class={`bg-muted w-full overflow-hidden rounded-full ${size === "sm" ? "h-1.5" : "h-2"} ${className ?? ""}`}
      {...(label
        ? {
            role: "progressbar",
            "aria-label": label,
            "aria-valuenow": Math.round(value),
            "aria-valuemin": 0,
            "aria-valuemax": 100,
          }
        : {})}
    >
      <div
        class={`h-full rounded-full transition-[width] duration-300 ${
          barClass ?? (value >= 100 ? "bg-green-500" : "bg-primary")
        }`}
        style={`width: ${width}%`}
      />
    </div>
  );
};
