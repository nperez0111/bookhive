import { useState, type FC } from "hono/jsx/dom";

import type { BookResult } from "../../scrapers";
import { useQuery } from "@tanstack/react-query";

export const SearchBox: FC<{}> = () => {
  const [query, setQuery] = useState("");
  const bookResults = useQuery({
    staleTime: 10000,
    queryKey: ["searchBooks", query],
    queryFn: async ({ signal }) => {
      if (query.length < 3) {
        return [];
      }
      const res = await fetch(
        `/xrpc/buzz.bookhive.searchBooks?q=${query}&limit=7`,
        { signal },
      );
      return (await res.json()) as BookResult[];
    },
  });

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
          onChange={(e) => {
            setQuery((e.target as HTMLInputElement).value);
          }}
        />
      </div>
      {!!bookResults.data?.length && (
        <ul
          id="search-results"
          role="list"
          class="absolute left-0 z-10 mt-2 w-[calc(100%+64px)] origin-top-right divide-y divide-gray-100 rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none dark:divide-gray-700 dark:bg-slate-700"
        >
          {bookResults.data.map((book) => (
            <li class="px-1 py-2">
              <a
                href={`/book/${book.id}`}
                onClick={async (e) => {
                  e.preventDefault();

                  const response = await fetch(`/books`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      author: book.authors.join(", "),
                      title: book.title,
                      year: book.publishedDate,
                      // isbn: book.identifiers.goodreads,
                      coverImage: book.cover || book.thumbnail,
                      // hiveId: book.id,
                    }),
                  });
                  console.log(await response.json());
                }}
                class="flex items-center justify-between gap-x-6 space-x-4 rounded-md px-2 py-3 hover:bg-slate-800"
              >
                <div class="flex items-center justify-between space-x-4">
                  <img
                    class="h-20 rounded object-cover shadow-sm"
                    src={book.thumbnail || book.cover}
                    height="80px"
                    width="60px"
                    alt=""
                  />
                  <div>
                    <p class="text-sm font-semibold">{book.title}</p>
                    <p class="text-xs text-gray-200">
                      by {book.authors.join(", ")}
                    </p>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
