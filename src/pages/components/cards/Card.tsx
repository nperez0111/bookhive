import type { FC, Child } from "hono/jsx";

export const Card: FC<{ class?: string; children?: Child }> = ({ class: className, children }) => {
  return <div class={className ? `card ${className}` : "card"}>{children}</div>;
};

export const CardHeader: FC<{ class?: string; children?: Child }> = ({
  class: className,
  children,
}) => {
  return <div class={className ? `card-header ${className}` : "card-header"}>{children}</div>;
};

export const CardTitle: FC<{ class?: string; children?: Child }> = ({
  class: className,
  children,
}) => {
  return <h2 class={className ? `card-title ${className}` : "card-title"}>{children}</h2>;
};

export const CardBody: FC<{ class?: string; children?: Child }> = ({
  class: className,
  children,
}) => {
  return <div class={className ? `card-body ${className}` : "card-body"}>{children}</div>;
};
