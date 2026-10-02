import type { FC } from "hono/jsx";
import { format, formatDistanceToNowStrict } from "date-fns";

/**
 * The one relative timestamp. Uses `formatDistanceToNowStrict` (not the fuzzy
 * `formatDistanceToNow`, whose hedges read as inconsistency between rows) and
 * renders a `<time datetime>` with an absolute `title` for verification.
 */
export const TimeAgo: FC<{
  /** ISO timestamp. */
  ts: string;
  class?: string;
}> = ({ ts, class: className }) => {
  const date = new Date(ts);
  return (
    <time
      datetime={ts}
      title={format(date, "PPPp XXX")}
      class={`text-muted-foreground text-xs tabular-nums ${className ?? ""}`}
    >
      {formatDistanceToNowStrict(date, { addSuffix: true })}
    </time>
  );
};
