import { type FC } from "hono/jsx/dom";

export const ProgressBar: FC<{
  class?: string;
  containerClass?: string;
  isActive: boolean;
}> = ({
  class: className = "dark:bg-white bg-blue-950",
  containerClass,
  isActive,
}) => {
  return (
    <div class={`relative w-full p-[1px] ${containerClass}`}>
      <div
        class={`absolute inset-0 right-full w-0 animate-[loadingBar_2s_linear_infinite] rounded-xs ${className} ${isActive ? "" : "opacity-0"}`}
      ></div>
    </div>
  );
};
