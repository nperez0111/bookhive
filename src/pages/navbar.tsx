import { type FC } from "hono/jsx";
import { Script } from "./utils/script";
import type { ProfileViewDetailed } from "../types";

export const Navbar: FC<{
  profile?: ProfileViewDetailed | null;
}> = ({ profile }) => {
  return (
    <header class="top-bar border-border bg-background border-b">
      <div class="flex h-16 items-center gap-3 px-4 lg:px-6">
        {/* Mobile hamburger - hidden when sidebar visible (md+) */}
        <button
          class="sidebar-toggle shrink-0 md:hidden"
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
        <a href="/" class="flex shrink-0 items-center md:hidden">
          <img src="/book.svg" alt="" width="24" height="24" />
          <span class="ml-2 font-bold">BookHive</span>
        </a>

        {/* Search — form is the no-JS fallback; JS replaces it with the palette trigger */}
        <div id="mount-search-box" class="min-w-0 max-w-md flex-1">
          <form action="/search" method="get" class="relative w-full">
            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg
                class="size-4 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z"
                />
              </svg>
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

        {/* Right group: theme toggle + user — hidden on mobile (moved to sidebar) */}
        <div class="ml-auto hidden shrink-0 items-center gap-2 md:flex">
          {/* Dark mode toggle */}
          <button
            type="button"
            class="theme-toggle flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Toggle dark mode"
            id="theme-toggle"
          >
            <svg
              class="size-5 dark:hidden"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M21.752 15.752A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.248z"
              />
            </svg>
            <svg
              class="hidden size-5 dark:block"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
              />
            </svg>
          </button>

          {/* User */}
          {profile ? (
            <div class="avatar-dropdown relative">
              <button
                class="avatar bg-secondary flex size-8 items-center justify-center rounded-full"
                id="user-menu-button"
                aria-expanded="false"
                aria-haspopup="true"
              >
                {profile?.avatar ? (
                  <img class="size-8 rounded-full" src={profile.avatar} loading="lazy" alt="" />
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
              </button>

              <div
                id="user-menu"
                class="dropdown-menu bg-card ring-border absolute right-0 z-50 mt-2 w-48 origin-top-right rounded-md shadow-lg ring-1"
                role="menu"
                aria-orientation="vertical"
                aria-labelledby="user-menu-button"
                tabindex={-1}
                style="display: none;"
              >
                <a
                  href={`/profile/${profile.handle}`}
                  class="text-card-foreground hover:bg-muted block px-4 py-2 text-sm"
                  role="menuitem"
                  tabindex={-1}
                >
                  Profile
                </a>
                <a
                  href="/refresh-books"
                  class="text-card-foreground hover:bg-muted block px-4 py-2 text-sm"
                  role="menuitem"
                  tabindex={-1}
                >
                  Refresh Books
                </a>
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    class="text-card-foreground hover:bg-muted block w-full cursor-pointer px-4 py-2 text-left text-sm"
                    role="menuitem"
                    tabindex={-1}
                  >
                    Sign out
                  </button>
                </form>
              </div>

              <Script
                script={(document) => {
                  const btn = document.getElementById("user-menu-button")!;
                  const menu = document.getElementById("user-menu")!;

                  // close the dropdown when clicking outside of it
                  document.addEventListener("click", (e) => {
                    if (e.target !== btn && !btn.contains(e.target as Node)) {
                      btn.setAttribute("aria-expanded", "false");
                      menu.style.display = "none";
                    }
                  });

                  btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const shouldExpand = btn.getAttribute("aria-expanded") !== "true";
                    btn.setAttribute("aria-expanded", String(shouldExpand));
                    menu.style.display = shouldExpand ? "block" : "none";
                  });
                }}
              />
            </div>
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
      {/* Theme toggle — handles all .theme-toggle buttons (navbar + sidebar) */}
      <Script
        script={(document) => {
          const updateThemeColor = () => {
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) {
              meta.setAttribute(
                "content",
                document.documentElement.classList.contains("dark") ? "#422006" : "#f9eabc",
              );
            }
          };
          updateThemeColor();
          document.querySelectorAll(".theme-toggle").forEach((btn) => {
            btn.addEventListener("click", () => {
              const html = document.documentElement;
              const isDark = html.classList.toggle("dark");
              localStorage.setItem("theme", isDark ? "dark" : "light");
              updateThemeColor();
            });
          });
        }}
      />
    </header>
  );
};
