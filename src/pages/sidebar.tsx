import type { FC } from "hono/jsx";
import { Script } from "./utils/script";

interface SidebarProps {
  currentPath: string;
  pdsEnabled?: boolean;
  user?: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
}

export const Sidebar: FC<SidebarProps> = async ({ currentPath, pdsEnabled, user }) => {
  const navItems = [
    { href: "/", label: "Home", icon: "home", authRequired: false },
    { href: "/feed", label: "Activity Feed", icon: "activity", authRequired: true },
    {
      href: user ? `/profile/${user.handle}` : "/profile",
      label: "My Books",
      icon: "book",
      authRequired: true,
    },
    {
      href: user ? `/profile/${user.handle}/stats` : "/profile",
      label: "Year in Books",
      icon: "chart",
      authRequired: true,
    },
    {
      href: user ? `/shelves/${user.handle}` : "/shelves",
      label: "Shelves",
      icon: "shelf",
      authRequired: true,
    },
    { href: "/explore", label: "Explore", icon: "compass", authRequired: false },
    { href: "/import", label: "Import", icon: "upload", authRequired: true },
    ...(pdsEnabled
      ? [{ href: "/pds", label: "Community", icon: "users", authRequired: false }]
      : []),
  ].filter((item) => !item.authRequired || user);

  return (
    <nav class="sidebar" aria-label="Main navigation">
      <header>
        <img src="/book.svg" alt="" width="24" height="24" />
        <span>BookHive</span>
      </header>

      <ul>
        {navItems.map((item) => {
          const isActive =
            currentPath === item.href ||
            (item.href.includes("/stats") && currentPath.includes("/stats")) ||
            (item.href === "/explore" && currentPath.startsWith("/explore")) ||
            (item.icon === "shelf" && currentPath.startsWith("/shelves"));
          return (
            <li>
              <a href={item.href} aria-current={isActive ? "page" : undefined}>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>

      {user ? (
        <>
          <hr />
          <ul>
            <li>
              <a href={`/profile/${user.handle}`}>
                <div class="avatar">
                  <img src={user.avatar || "/default-avatar.png"} alt="" />
                </div>
                <span>@{user.handle}</span>
              </a>
            </li>
            <li class="md:hidden">
              <form action="/logout" method="post">
                <button
                  type="submit"
                  class="flex w-full cursor-pointer items-center gap-2 text-left"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="size-4 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </>
      ) : (
        <div class="md:hidden" style="padding: 0.75rem 1rem;">
          <a href="/login" class="btn btn-primary btn-sm w-full text-center">
            Buzz in
          </a>
        </div>
      )}

      <footer>
        {/* Theme toggle — visible on mobile only (hidden on desktop where navbar has it) */}
        <button
          type="button"
          class="theme-toggle md:hidden flex items-center gap-2"
          aria-label="Toggle dark mode"
        >
          <svg
            class="size-4 shrink-0 dark:hidden"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            aria-hidden
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M21.752 15.752A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.248z"
            />
          </svg>
          <svg
            class="hidden size-4 shrink-0 dark:block"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            aria-hidden
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
            />
          </svg>
          Toggle theme
        </button>
        <a
          href="/privacy-policy"
          aria-current={currentPath === "/privacy-policy" ? "page" : undefined}
          class="flex items-center gap-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          </svg>
          Privacy
        </a>
        <a
          href="/legal"
          aria-current={currentPath === "/legal" ? "page" : undefined}
          class="flex items-center gap-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M7 8h10M7 12h10M7 16h6" />
          </svg>
          Terms
        </a>
        <a
          href="https://github.com/nperez0111/bookhive"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-4 shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          GitHub
        </a>
      </footer>
    </nav>
  );
};
