import { type Child, type FC } from "hono/jsx";
import type { Book } from "../../types";
import { BOOK_STATUS } from "../../constants";
import { useRequestContext } from "hono/jsx-renderer";
import { hydrateUserBook } from "../../utils/bookProgress";
import { BookCard, normalizeBookData } from "./BookCard";

const NO_BOOKS_FOUND = <p className="text-center text-lg">No books in this list</p>;

export const BookList: FC<{
  books?: Book[];
  fallback?: Child;
}> = async ({ books: booksFromProps, fallback }) => {
  const c = useRequestContext();
  const agent = await c.get("ctx").getSessionAgent();
  const books =
    booksFromProps ||
    (agent
      ? await c
          .get("ctx")
          .db.selectFrom("user_book")
          .innerJoin("hive_book", "user_book.hiveId", "hive_book.id")
          .selectAll()
          .where("user_book.userDid", "=", agent.did)
          .orderBy("user_book.createdAt", "desc")
          .limit(10_000)
          .execute()
          .then((books) => books.map((book) => hydrateUserBook(book)))
      : []);

  if (!books?.length) {
    return (fallback || NO_BOOKS_FOUND) as any;
  }

  const readingBooks = (books ?? [])
    .filter((book) => book.status === BOOK_STATUS.READING)
    .sort((a, b) => {
      const aDate = a.bookProgress?.updatedAt || a.startedAt || a.createdAt;
      const bDate = b.bookProgress?.updatedAt || b.startedAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  const wantBooks = (books ?? []).filter((book) => book.status === BOOK_STATUS.WANTTOREAD);
  const readBooks = (books ?? [])
    .filter((book) => book.status === BOOK_STATUS.FINISHED)
    .sort((a, b) => {
      if (!a.finishedAt && !b.finishedAt) return 0;
      if (!a.finishedAt) return 1;
      if (!b.finishedAt) return -1;
      return new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime();
    });

  if (!readingBooks.length && !wantBooks.length && !readBooks.length) {
    return (fallback || NO_BOOKS_FOUND) as any;
  }

  // Default to first non-empty tab
  const defaultTab = readingBooks.length
    ? "reading"
    : wantBooks.length
      ? "want"
      : "read";

  return (
    <div class="relative overflow-x-clip rounded-lg bg-card pb-16">
      <input type="radio" id="tab-read" name="tabs" class="peer/read hidden"
        checked={defaultTab === "read" || undefined} />
      <input type="radio" id="tab-want" name="tabs" class="peer/want hidden"
        checked={defaultTab === "want" || undefined} />
      <input type="radio" id="tab-reading" name="tabs" class="peer/reading hidden"
        checked={defaultTab === "reading" || undefined} />

      <div class="mb-4 border-b border-border peer-checked/read:[&_label[for='tab-read']]:border-primary peer-checked/read:[&_label[for='tab-read']]:text-primary peer-checked/reading:[&_label[for='tab-reading']]:border-primary peer-checked/reading:[&_label[for='tab-reading']]:text-primary peer-checked/want:[&_label[for='tab-want']]:border-primary peer-checked/want:[&_label[for='tab-want']]:text-primary">
        <ul class="-mb-px flex flex-wrap text-center text-sm font-medium" role="tablist">
          {readingBooks.length > 0 && (
            <li class="me-2" role="presentation">
              <label
                for="tab-reading"
                role="tab"
                aria-selected={defaultTab === "reading" ? "true" : "false"}
                aria-controls="tab-reading-panel"
                class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Reading{" "}
                <span class="text-base text-gray-400 dark:text-gray-500">
                  {readingBooks.length}
                </span>
              </label>
            </li>
          )}
          {wantBooks.length > 0 && (
            <li class="me-2" role="presentation">
              <label
                for="tab-want"
                role="tab"
                aria-selected={defaultTab === "want" ? "true" : "false"}
                aria-controls="tab-want-panel"
                class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Want to Read{" "}
                <span class="text-base text-gray-400 dark:text-gray-500">{wantBooks.length}</span>
              </label>
            </li>
          )}
          {readBooks.length > 0 && (
            <li class="me-2" role="presentation">
              <label
                for="tab-read"
                role="tab"
                aria-selected={defaultTab === "read" ? "true" : "false"}
                aria-controls="tab-read-panel"
                class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Read{" "}
                <span class="text-base text-gray-400 dark:text-gray-500">{readBooks.length}</span>
              </label>
            </li>
          )}
        </ul>
      </div>

      {readBooks.length > 0 && (
        <div
          id="tab-read-panel"
          role="tabpanel"
          aria-labelledby="tab-read"
          class="mt-8 hidden peer-checked/read:block"
        >
          <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {readBooks.map((book) => (
              <BookCard variant="dense" book={normalizeBookData(book)} />
            ))}
          </ul>
        </div>
      )}
      {readingBooks.length > 0 && (
        <div
          id="tab-reading-panel"
          role="tabpanel"
          aria-labelledby="tab-reading"
          class="mt-8 hidden peer-checked/reading:block"
        >
          <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {readingBooks.map((book) => (
              <BookCard variant="dense" book={normalizeBookData(book)} />
            ))}
          </ul>
        </div>
      )}
      {wantBooks.length > 0 && (
        <div
          id="tab-want-panel"
          role="tabpanel"
          aria-labelledby="tab-want"
          class="mt-8 hidden peer-checked/want:block"
        >
          <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {wantBooks.map((book) => (
              <BookCard variant="dense" book={normalizeBookData(book)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
