/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";
import { Script } from "./utils/script";

export const Navbar: FC<{
  tab?: "home";
  profileAvatar?: string;
  hasProfile: boolean;
}> = ({ tab, profileAvatar, hasProfile }) => {
  return (
    <nav class="bg-gray-800">
      <div class="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8">
        <div class="relative flex h-16 items-center justify-between">
          <div class="absolute inset-y-0 left-0 flex items-center sm:hidden">
            {/* Mobile menu button*/}
            <button
              type="button"
              class="relative inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
              aria-controls="mobile-menu"
              aria-expanded="false"
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
            <div class="flex shrink-0 items-center">
              <img
                class="h-8 w-auto"
                src="https://tailwindui.com/plus/img/logos/mark.svg?color=indigo&shade=500"
                alt="Your Company"
              />
            </div>
            <div class="hidden sm:ml-6 sm:block">
              <div class="flex space-x-4">
                <a
                  href="/"
                  class={
                    "rounded-md px-3 py-2 text-sm font-medium" +
                    (tab === "home"
                      ? " bg-gray-900 text-white"
                      : " text-gray-300 hover:bg-gray-700 hover:text-white")
                  }
                  aria-current="page"
                >
                  Home
                </a>
              </div>
            </div>
          </div>
          <div class="absolute inset-y-0 right-0 flex items-center pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0">
            {hasProfile && <div id="mount-search-box" />}
            {/* Profile dropdown */}
            {!hasProfile && (
              <a
                href="/login"
                class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Buzz in
              </a>
            )}
            <div class="relative ml-3">
              <div>
                <button
                  type="button"
                  class="relative flex rounded-full bg-gray-800 text-sm text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-gray-800"
                  id="user-menu-button"
                  aria-expanded="false"
                  aria-haspopup="true"
                >
                  <span class="absolute -inset-1.5"></span>
                  <span class="sr-only">Open user menu</span>
                  {profileAvatar ? (
                    <img
                      class="size-8 rounded-full"
                      src={profileAvatar}
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
                class="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
                role="menu"
                aria-orientation="vertical"
                aria-labelledby="user-menu-button"
                tabindex={-1}
                style="display: none;"
              >
                {/* Active: "bg-gray-100 outline-none", Not Active: "" */}
                <a
                  href="#"
                  class="block px-4 py-2 text-sm text-gray-700"
                  role="menuitem"
                  tabindex={-1}
                  id="user-menu-item-0"
                >
                  Your Profile
                </a>
                <form action="/refresh-books" method="get">
                  <button
                    class="block px-4 py-2 text-sm text-gray-700"
                    type="submit"
                    role="menuitem"
                    tabindex={-1}
                    id="user-menu-item-1"
                  >
                    Refresh all data
                  </button>
                </form>
                <a
                  href="#"
                  class="block px-4 py-2 text-sm text-gray-700"
                  role="menuitem"
                  tabindex={-1}
                  id="user-menu-item-2"
                >
                  Settings
                </a>
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    class="block px-4 py-2 text-sm text-gray-700"
                    role="menuitem"
                    tabindex={-1}
                    id="user-menu-item-3"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile menu, show/hide based on menu state. */}
      <div class="sm:hidden" id="mobile-menu">
        <div class="space-y-1 px-2 pb-3 pt-2">
          {/* Current: "bg-gray-900 text-white", Default: "text-gray-300 hover:bg-gray-700 hover:text-white" */}
          <a
            href="#"
            class="block rounded-md bg-gray-900 px-3 py-2 text-base font-medium text-white"
            aria-current="page"
          >
            Dashboard
          </a>
          <a
            href="#"
            class="block rounded-md px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            Team
          </a>
          <a
            href="#"
            class="block rounded-md px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            Projects
          </a>
          <a
            href="#"
            class="block rounded-md px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            Calendar
          </a>
        </div>
      </div>
    </nav>
  );
};
