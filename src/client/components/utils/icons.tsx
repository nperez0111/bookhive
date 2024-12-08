import { type FC } from "hono/jsx/dom";

export const Star: FC = () => {
  return (
    <svg class="relative inline-flex w-8" viewBox="0 0 23 23">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <circle
          cx="12"
          cy="12"
          r="10"
          class="fill-current text-transparent"
        ></circle>
        <path
          class="fill-current text-yellow-400"
          d="M9.53 16.93a1 1 0 0 1-1.45-1.05l.47-2.76-2-1.95a1 1 0 0 1 .55-1.7l2.77-.4 1.23-2.51a1 1 0 0 1 1.8 0l1.23 2.5 2.77.4a1 1 0 0 1 .55 1.71l-2 1.95.47 2.76a1 1 0 0 1-1.45 1.05L12 15.63l-2.47 1.3z"
        ></path>
      </svg>
    </svg>
  );
};
