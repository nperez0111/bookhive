import type { FC } from "hono/jsx";

export const SimpleNavbar: FC<{ isPds: boolean; homeUrl?: string }> = ({
  isPds,
  homeUrl = "/",
}) => {
  return (
    <header class="top-bar border-border bg-background border-b">
      <div class="flex h-16 items-center gap-3 px-4 lg:px-6">
        <a href={homeUrl} class="flex shrink-0 items-center">
          <img src="/book.svg" alt="" width="24" height="24" />
          <span class="ml-2 font-bold">{isPds ? "BookHive.social" : "BookHive"}</span>
        </a>
      </div>
    </header>
  );
};
