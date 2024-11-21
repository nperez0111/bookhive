import { useEffect, useRef, useState, type FC } from "hono/jsx/dom";

import type { BookResult } from "../../scrapers";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ProgressBar } from "./LoadingBar";
import { useDebounce } from "./utils/useDebounce";

export const SearchBox: FC = () => {
  const [isOpened, setIsOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  const bookResults = useQuery<BookResult[]>({
    staleTime: 10000,
    enabled: query.length > 2,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData(previousData) {
      return previousData || [];
    },
    queryKey: ["searchBooks", debouncedQuery],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/xrpc/buzz.bookhive.searchBooks?q=${debouncedQuery}&limit=10`,
        { signal },
      );

      if (!res.ok) {
        throw new Error("Search failed");
      }

      return res.json();
    },
  });

  // TODO should probably just be a page navigation
  const addBookMutation = useMutation({
    mutationFn: async (book: BookResult) => {
      const response = await fetch(`/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: book.authors.join(", "),
          title: book.title,
          year: book.publishedDate,
          coverImage: book.cover || book.thumbnail,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save book");
      }

      return response.json();
    },
    onSuccess: () => {
      setIsOpened(false);
      // Could add toast notification here
    },
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setIsOpened(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (debouncedQuery) {
      setIsOpened(true);
      setSelectedIndex(-1);
    }
  }, [debouncedQuery]);

  const handleFocus = () => {
    if ((bookResults.data?.length || 0) > 0) {
      setIsOpened(true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const books = bookResults.data || [];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, books.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && books[selectedIndex]) {
          addBookMutation.mutate(books[selectedIndex]);
        }
        break;
      case "Escape":
        setIsOpened(false);
        break;
    }
  };

  return (
    <div ref={searchRef} className="relative ml-3">
      <div className="relative rounded-md shadow-sm">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <span className="text-gray-500 sm:text-sm">🔍</span>
        </div>
        <input
          type="search"
          role="combobox"
          aria-expanded={isOpened}
          aria-controls="search-results"
          aria-activedescendant={
            selectedIndex >= 0 ? `book-${selectedIndex}` : undefined
          }
          autocomplete="off"
          placeholder="Search books..."
          id="search-books"
          className="block w-64 rounded-md border-0 py-1.5 pl-8 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6 dark:placeholder:text-gray-800"
          value={query}
          onFocus={handleFocus}
          onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => handleKeyDown(e as unknown as KeyboardEvent)}
        />
      </div>
      {isOpened && (
        <ul
          id="search-results"
          role="listbox"
          className="absolute left-0 z-10 mt-2 w-[calc(100%+64px)] origin-top-right divide-y divide-gray-100 rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none dark:divide-gray-700 dark:bg-slate-700"
        >
          <ProgressBar isActive={bookResults.isFetching} />
          {bookResults.isError && (
            <li className="px-4 py-2 text-red-500">Failed to search books</li>
          )}
          {bookResults.status === "success" &&
            bookResults.data.map((book, index) => (
              <li
                key={book.id}
                id={`book-${index}`}
                role="option"
                aria-selected={index === selectedIndex}
                className={`px-1 py-2 ${index === selectedIndex ? "bg-slate-800" : ""}`}
              >
                <button
                  onClick={() => addBookMutation.mutate(book)}
                  className="flex w-full items-center justify-between gap-x-6 space-x-4 rounded-md px-2 py-3 text-left hover:bg-slate-800"
                >
                  <div className="flex items-center justify-between space-x-4">
                    <img
                      className="h-20 rounded object-cover shadow-sm"
                      src={book.thumbnail || book.cover}
                      height="80"
                      width="60"
                      alt={`Cover of ${book.title}`}
                      loading="lazy"
                    />
                    <div>
                      <p className="text-sm font-semibold">{book.title}</p>
                      <p className="text-xs text-gray-200">
                        by {book.authors.join(", ")}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          {debouncedQuery.length > 2 && bookResults.data?.length === 0 && (
            <li className="px-4 py-2">No results found</li>
          )}
          {debouncedQuery.length <= 2 && (
            <li className="px-4 py-2">Type more to search...</li>
          )}
        </ul>
      )}
    </div>
  );
};
