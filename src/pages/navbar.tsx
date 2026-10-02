import { type FC } from "hono/jsx";
import { Script } from "./utils/script";
import type { ProfileViewDetailed } from "../types";
import { avatarImageUrl } from "../core/imageUrl";
import { ThemeToggle, ThemeToggleScript } from "./components/ThemeToggle";
import { Search } from "./components/icons";

export const Navbar: FC<{
  profile?: ProfileViewDetailed | null;
}> = ({ profile }) => {
  return (
    <header class="top-bar border-border bg-background border-b">
      <div class="flex h-16 items-center gap-3 px-4 lg:px-6">
        {/* Mobile hamburger - hidden when sidebar visible (md+) */}
        <button
          class="sidebar-toggle flex size-10 shrink-0 items-center justify-center rounded-md transition-[transform,background-color] duration-150 active:scale-[0.96] md:hidden"
          aria-label="Toggle menu"
          id="sidebar-toggle"
        >
          <svg
            class="size-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>

        {/* Logo - hidden when sidebar visible (md+) */}
        <a
          href={profile ? "/home" : "/"}
          class="flex shrink-0 items-center md:hidden"
          aria-label="BookHive home"
        >
          <img src="/book.svg" alt="" width="24" height="24" />
          <span class="ml-2 hidden font-bold sm:inline">BookHive</span>
        </a>

        {/* Search — form is the no-JS fallback; JS replaces it with the palette trigger */}
        <div id="mount-search-box" class="min-w-0 max-w-md flex-1">
          <form action="/search" method="get" class="relative w-full">
            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search class="size-4 text-muted-foreground" />
            </div>
            <input
              type="search"
              name="q"
              placeholder="Search books..."
              autocomplete="off"
              class="block w-full min-w-0 rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </form>
        </div>

        {/* Account access at every size; the mobile theme toggle stays in the sidebar. */}
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle class="hidden md:flex size-10 items-center justify-center rounded-md text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]" />

          {profile ? (
            <details id="account-menu" class="relative">
              <summary
                class="list-none cursor-pointer [&::-webkit-details-marker]:hidden avatar bg-secondary flex size-10 items-center justify-center rounded-full transition-[transform] duration-150 active:scale-[0.96]"
                id="user-menu-button"
                aria-label="Account menu"
              >
                {profile?.avatar ? (
                  <img
                    class="size-10 rounded-full outline outline-1 outline-black/10 dark:outline-white/10"
                    src={avatarImageUrl(profile.did, { size: 80 })}
                    loading="lazy"
                    alt=""
                  />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="10" r="3" />
                    <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
                  </svg>
                )}
              </summary>

              <div
                id="user-menu"
                role="group"
                class="bg-card absolute right-0 z-50 mt-2 w-48 origin-top-right rounded-xl p-1 shadow-[0_16px_40px_rgba(0,0,0,0.28),0_4px_12px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.55),0_4px_12px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.12)]"
                aria-label="Account"
              >
                <a
                  href={`/profile/${profile.handle}`}
                  class="text-card-foreground hover:bg-muted block min-h-10 rounded-lg px-3 py-2 text-sm transition-[background-color] duration-150"
                >
                  View my profile
                </a>
                <a
                  href={`/profile/${profile.handle}/stats`}
                  class="text-card-foreground hover:bg-muted block min-h-10 rounded-lg px-3 py-2 text-sm transition-[background-color] duration-150"
                >
                  Year in Books
                </a>
                <a
                  href="/import"
                  class="text-card-foreground hover:bg-muted block min-h-10 rounded-lg px-3 py-2 text-sm transition-[background-color] duration-150"
                >
                  Import books
                </a>
                <a
                  href="/settings"
                  class="text-card-foreground hover:bg-muted block min-h-10 rounded-lg px-3 py-2 text-sm transition-[background-color] duration-150"
                >
                  Settings
                </a>
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    class="text-card-foreground hover:bg-muted block w-full min-h-10 cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-[background-color] duration-150"
                  >
                    Sign out
                  </button>
                </form>
              </div>

              <Script
                script={(document) => {
                  const menu = document.getElementById("account-menu") as HTMLDetailsElement;
                  const trigger = document.getElementById("user-menu-button")!;
                  document.addEventListener("click", (e) => {
                    if (!menu.contains(e.target as Node)) menu.open = false;
                  });
                  menu.addEventListener("keydown", (e) => {
                    if (e.key === "Escape" && menu.open) {
                      e.preventDefault();
                      menu.open = false;
                      trigger.focus();
                    }
                  });
                  menu.addEventListener("focusout", (e) => {
                    if (e.relatedTarget && !menu.contains(e.relatedTarget as Node))
                      menu.open = false;
                  });
                }}
              />
            </details>
          ) : (
            <a href="/login" class="btn btn-primary btn-sm">
              Buzz in
            </a>
          )}
        </div>
      </div>
      {/* Sidebar toggle + backdrop: runs for all users */}
      <Script
        script={(document) => {
          const sidebar = document.querySelector(".sidebar");
          const sidebarToggle = document.getElementById("sidebar-toggle");
          const backdrop = document.getElementById("sidebar-backdrop");
          const openSidebar = () => {
            sidebar?.classList.add("open");
            backdrop?.classList.add("open");
            backdrop?.setAttribute("aria-hidden", "false");
          };
          const closeSidebar = () => {
            sidebar?.classList.remove("open");
            backdrop?.classList.remove("open");
            backdrop?.setAttribute("aria-hidden", "true");
          };
          if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener("click", () => {
              if (sidebar.classList.contains("open")) closeSidebar();
              else openSidebar();
            });
          }
          backdrop?.addEventListener("click", closeSidebar);
        }}
      />
      {/* Capture-phase listener, since `load` doesn't bubble — covers every `.book-cover` on the page, including lazy ones and islands rendered after hydration. */}
      <Script
        script={(document) => {
          const isCover = (el: EventTarget | null): el is HTMLImageElement =>
            el instanceof HTMLImageElement && el.classList.contains("book-cover");
          document.addEventListener(
            "load",
            (e) => {
              if (isCover(e.target)) e.target.classList.add("is-loaded");
            },
            true,
          );
          document.querySelectorAll("img.book-cover").forEach((img) => {
            if ((img as HTMLImageElement).complete) img.classList.add("is-loaded");
          });
        }}
      />
      {/* Handles all .theme-toggle buttons on the page (navbar + sidebar drawer) */}
      <ThemeToggleScript />
    </header>
  );
};
