import type { FC, Child } from "hono/jsx";

export const CardActions: FC<{
  class?: string;
  children?: Child;
  onclick?: string;
}> = ({ class: className, children, onclick }) => {
  return (
    <div class={className ? `flex gap-2 ${className}` : "flex gap-2"} onclick={onclick}>
      {children}
    </div>
  );
};
