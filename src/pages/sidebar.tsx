import type { FC } from "hono/jsx";

interface SidebarProps {
  currentPath: string;
  user?: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
}

export const Sidebar: FC<SidebarProps> = async ({ currentPath, user }) => {
  const navItems = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/feed", label: "Activity Feed", icon: "activity" },
    {
      href: user ? `/profile/${user.handle}` : "/profile",
      label: "My Books",
      icon: "book",
    },
    { href: "/genres", label: "Discover", icon: "compass" },
    { href: "/import", label: "Import", icon: "upload" },
  ];

  return (
    <nav class="sidebar" aria-label="Main navigation">
      <header>
        <img src="/public/book.svg" alt="" width="24" height="24" />
        <span>BookHive</span>
      </header>

      <ul>
        {navItems.map((item) => (
          <li>
            <a
              href={item.href}
              aria-current={currentPath === item.href ? "page" : undefined}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>

      {user && (
        <>
          <hr />
          <ul>
            <li>
              <a href={`/profile/${user.handle}`}>
                <div class="avatar">
                  <img
                    src={user.avatar || "/public/default-avatar.png"}
                    alt=""
                  />
                </div>
                <span>@{user.handle}</span>
              </a>
            </li>
          </ul>
        </>
      )}

      <footer>
        <a href="/privacy-policy">Privacy</a>
        <a
          href="https://github.com/nperez0111/bookhive"
          target="_blank"
          rel="noopener"
        >
          GitHub
        </a>
      </footer>
    </nav>
  );
};
