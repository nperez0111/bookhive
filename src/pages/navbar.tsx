import { type FC } from "hono/jsx";
import { Script } from "./utils/script";
import type { ProfileViewDetailed } from "../types";

export const Navbar: FC<{
  profile?: ProfileViewDetailed | null;
}> = ({ profile }) => {
  return (
    <nav class="bg-yellow-800">
      <div class="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8">
        <div class="relative flex h-16 items-center justify-between">
          <div class="absolute inset-y-0 left-0 flex items-center sm:hidden">
            {/* Mobile menu button*/}
            <button
              type="button"
              class="relative inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-zinc-700 hover:text-white focus:ring-2 focus:ring-white focus:outline-hidden focus:ring-inset"
              aria-controls="mobile-menu"
              aria-expanded="false"
              id="mobile-menu-button"
            >
              <span class="absolute -inset-0.5"></span>
              <span class="sr-only">Open main menu</span>
              {/*
            Icon when menu is closed.

            Menu open: "hidden", Menu closed: "block"
          */}
              <svg
                class="block size-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                aria-hidden="true"
                data-slot="icon"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
              {/*
            Icon when menu is open.

            Menu open: "block", Menu closed: "hidden"
          */}
              <svg
                class="hidden size-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                aria-hidden="true"
                data-slot="icon"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div class="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
            <a href="/" class="hidden shrink-0 items-center sm:flex">
              <img src="/public/book.svg" class="h-11 w-9" />

              <div class="ml-2 text-3xl font-bold tracking-tight text-white">
                BookHive
              </div>
            </a>
            <div class="hidden items-center space-x-4 sm:ml-6 sm:flex">
              <a
                href="/genres"
                class="rounded-md px-3 py-2 text-sm font-medium text-gray-300 transition-colors duration-200 hover:bg-yellow-900 hover:text-white"
              >
                Genres
              </a>
            </div>
          </div>
          <div class="absolute inset-y-0 right-0 left-12 flex items-center pr-2 sm:static sm:inset-auto sm:left-auto sm:ml-6 sm:pr-0">
            {Boolean(profile) && <div id="mount-search-box" />}
            {/* Profile dropdown */}
            {profile ? (
              <div class="relative ml-3">
                <div>
                  <button
                    type="button"
                    class="relative flex rounded-full bg-zinc-800 text-sm text-gray-400 hover:text-white focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-gray-800 focus:outline-hidden"
                    id="user-menu-button"
                    aria-expanded="false"
                    aria-haspopup="true"
                  >
                    <span class="absolute -inset-1.5"></span>
                    <span class="sr-only">Open user menu</span>
                    {profile?.avatar ? (
                      <img
                        class="size-8 rounded-full"
                        src={`/images/w_100/${profile.avatar}`}
                        alt=""
                      />
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
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
                </div>

                <Script
                  script={(document) => {
                    const btn = document.getElementById("user-menu-button")!;
                    const menu = document.getElementById("user-menu")!;

                    // close the dropdown when clicking outside of it
                    document.addEventListener("click", (e) => {
                      if (e.target !== btn) {
                        if (btn.getAttribute("aria-expanded") === "true") {
                          btn.setAttribute("aria-expanded", "false");
                          menu.style.display = "none";
                        }
                      }
                    });

                    btn.addEventListener("click", (e) => {
                      // prevent the click event from bubbling up to the document
                      e.stopPropagation();

                      const shouldExpand =
                        btn.getAttribute("aria-expanded") !== "true";

                      btn.setAttribute("aria-expanded", String(shouldExpand));
                      menu.style.display = shouldExpand ? "block" : "none";
                    });
                  }}
                />

                <div
                  id="user-menu"
                  class="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-hidden"
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="user-menu-button"
                  tabindex={-1}
                  style="display: none;"
                >
                  {/* Active: "bg-zinc-100 outline-hidden", Not Active: "" */}
                  <a
                    href="/profile"
                    class="block px-4 py-2 text-sm text-gray-700"
                    role="menuitem"
                    tabindex={-1}
                    id="user-menu-item-0"
                  >
                    Your Profile
                  </a>
                  <form action="/refresh-books" method="get">
                    <button
                      class="block cursor-pointer px-4 py-2 text-sm text-gray-700"
                      type="submit"
                      role="menuitem"
                      tabindex={-1}
                      id="user-menu-item-1"
                    >
                      Refresh my books
                    </button>
                  </form>
                  <a
                    href="/import"
                    class="block px-4 py-2 text-sm text-gray-700"
                    role="menuitem"
                    tabindex={-1}
                    id="user-menu-item-2"
                  >
                    Import books
                  </a>
                  <form action="/logout" method="post">
                    <button
                      type="submit"
                      class="block cursor-pointer px-4 py-2 text-sm text-gray-700"
                      role="menuitem"
                      tabindex={-1}
                      id="user-menu-item-3"
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <a
                href="/login"
                class="rounded-md border border-white bg-transparent px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
              >
                Buzz in
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu, show/hide based on menu state. */}
      <div class="sm:hidden" id="mobile-menu">
        <div class="space-y-1 px-2 pt-2 pb-3">
          <a
            href="/"
            class="block border-b border-gray-200 p-4 text-sm text-white"
            role="menuitem"
            tabindex={-1}
          >
            Home
          </a>
          <a
            href="/genres"
            class="block border-b border-gray-200 p-4 text-sm text-white"
            role="menuitem"
            tabindex={-1}
          >
            Genres
          </a>
          <a
            href="/profile"
            class="block border-b border-gray-200 p-4 text-sm text-white"
            role="menuitem"
            tabindex={-1}
          >
            My Books
          </a>
          <a
            href="/import"
            class="block border-b border-gray-200 p-4 text-sm text-white"
            role="menuitem"
            tabindex={-1}
          >
            Import books
          </a>
          <form action="/logout" method="post">
            <button
              type="submit"
              class="block w-full cursor-pointer p-4 text-left text-sm text-white"
              role="menuitem"
              tabindex={-1}
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
      <Script
        script={(document) => {
          const btn = document.getElementById("mobile-menu-button")!;
          const menu = document.getElementById("mobile-menu")!;

          // Default to closed
          menu.style.display = "none";

          btn.addEventListener("click", () => {
            const shouldExpand = btn.getAttribute("aria-expanded") !== "true";
            btn.setAttribute("aria-expanded", String(shouldExpand));
            menu.style.display = shouldExpand ? "block" : "none";
          });
        }}
      ></Script>
    </nav>
  );
};
