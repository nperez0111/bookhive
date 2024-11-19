/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";
import { Script } from "../utils/script";
import type { BookResult } from "../../scrapers";

export const SearchBox: FC<{}> = () => {
  return (
    <div class="relative ml-3">
      <div class="relative rounded-md shadow-sm">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <span class="text-gray-500 sm:text-sm">🔍</span>
        </div>
        <input
          type="search"
          autocomplete="off"
          placeholder="Search books..."
          id="search-books"
          class="block w-64 rounded-md border-0 py-1.5 pl-8 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6 dark:placeholder:text-gray-800"
        />
      </div>
      <ul
        id="search-results"
        role="list"
        class="absolute left-0 z-10 mt-2 w-[calc(100%+64px)] origin-top-right divide-y divide-gray-100 rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none dark:divide-gray-700 dark:bg-slate-700"
        style="display: none;"
      ></ul>
      <Script
        script={(document) => {
          const search = document.getElementById("search-books")!;
          const searchResults = document.getElementById("search-results")!;
          // // debounce function
          // function debounce(func: (...args: any[]) => void, wait: number) {
          //   let timeout: ReturnType<typeof setTimeout> | null = null;

          //   return (...args: any[]) => {
          //     if (timeout) {
          //       clearTimeout(timeout);
          //     }
          //     timeout = setTimeout(() => {
          //       func(...args);
          //     }, wait);
          //   };
          // }
          function throttle(func: (...args: any[]) => void, wait: number) {
            let lastRun: number | null = null;
            let timeout: ReturnType<typeof setTimeout> | null = null;

            return (...args: any[]) => {
              const now = Date.now();

              if (lastRun && now < lastRun + wait) {
                // If the function is being called before the wait period is over,
                // schedule it to run after the wait period
                if (timeout) {
                  clearTimeout(timeout);
                }
                timeout = setTimeout(() => {
                  lastRun = Date.now();
                  func(...args);
                }, wait);
              } else {
                // If enough time has passed, run the function immediately
                lastRun = now;
                func(...args);
              }
            };
          }
          let currentController: AbortController | null = null;

          const searchBooks = throttle(async (query) => {
            try {
              // Abort previous request if exists
              if (currentController) {
                currentController.abort();
              }

              // Create new controller for this request
              currentController = new AbortController();
              const res = await fetch(
                `/xrpc/buzz.bookhive.searchBooks?q=${query}&limit=7`,
              );
              const data: BookResult[] = await res.json();
              searchResults.style.display = "block";
              searchResults.innerHTML = "";

              data.forEach((book) => {
                const div = document.createElement("div");
                div.innerHTML = `
               <li class="px-1 py-2">
                 <a href="/book/${book.id}" class="flex px-2 py-3 rounded-md items-center justify-between gap-x-6 space-x-4 hover:bg-slate-800">
                    <div class="flex items-center justify-between space-x-4">
                      <img
                        class="h-20 rounded object-cover shadow-sm"
                        src="${book.thumbnail || book.cover}"
                        height="80px"
                        width="60px"
                        alt=""
                      />
                      <div>
                        <p class="text-sm font-semibold">
                          ${book.title}
                        </p>
                        <p class="text-xs text-gray-200">by ${book.authors.join(", ")}</p>
                      </div>
                    </div>
                  </a>
                </li>`;
                searchResults.appendChild(div);
              });
            } catch (error) {
              // Ignore AbortError as it's expected
              if ((error as Error).name !== "AbortError") {
                console.error("Search failed:", error);
              }
            }
          }, 400);

          search.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value;
            if (query.length < 3) {
              return;
            }
            searchBooks(query);
          });

          // close the dropdown when clicking outside of it
          document.addEventListener("click", (e) => {
            if (!(e.target as HTMLElement | null)?.contains(search)) {
              searchResults.style.display = "none";
              searchResults.innerHTML = "";
            }
          });
        }}
      />
    </div>
  );
};
