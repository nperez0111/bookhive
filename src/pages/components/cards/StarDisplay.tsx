import type { FC } from "hono/jsx";

/** Rating in 1-5 scale (e.g. stars/2 from backend). Renders 5 stars with partial fill. */
export const StarDisplay: FC<{
  rating: number;
  class?: string;
  size?: "sm" | "md";
}> = ({ rating, class: className, size = "md" }) => {
  const sizeClass = size === "sm" ? "w-4" : "relative inline-flex w-6";
  return (
    <div class={className ?? ""}>
      <div class="-ml-1 flex -space-x-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <svg class={sizeClass} viewBox="0 0 24 24" key={star}>
            <path
              class="fill-current text-gray-300"
              d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
            />
            <path
              style={{
                clipPath: `inset(0 ${
                  100 - Math.min(100, Math.max(0, (rating - (star - 1)) * 100))
                }% 0 0)`,
              }}
              class="fill-current text-amber-500"
              d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
            />
          </svg>
        ))}
      </div>
    </div>
  );
};

/** Simple star count (e.g. "★ ★ ★" or numeric). For inline text. */
export const StarCount: FC<{
  count: number;
  class?: string;
}> = ({ count, class: className }) => {
  if (count <= 0) return null;
  return <span class={className ?? "text-amber-500"}>{"★".repeat(Math.round(count))}</span>;
};
