import type { FC } from "hono/jsx";

export const SimpleNavbar: FC<{ isPds: boolean; homeUrl?: string }> = ({
  isPds,
  homeUrl = "/",
}) => {
  return (
    <header class="top-bar border-border bg-background border-b">
      <div class="flex h-16 items-center gap-3 px-4 lg:px-6">
        <a
          href={homeUrl}
          class="flex shrink-0 items-center min-h-[40px] min-w-[40px] rounded-md px-2 transition-[transform,background-color] duration-150 ease-out hover:bg-muted active:scale-[0.96]"
        >
          <img src="/book.svg" alt="" width="24" height="24" />
          <span class="ml-2 font-bold">{isPds ? "BookHive.social" : "BookHive"}</span>
        </a>
      </div>
    </header>
  );
};
