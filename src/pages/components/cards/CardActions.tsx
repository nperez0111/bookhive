import type { FC, Child } from "hono/jsx";

export const CardActions: FC<{ class?: string; children?: Child }> = ({
  class: className,
  children,
}) => {
  return (
    <div class={className ? `flex gap-2 ${className}` : "flex gap-2"}>
      {children}
    </div>
  );
};
