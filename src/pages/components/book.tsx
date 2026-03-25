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

  function orNoResults(arr: any[]) {
    if (!arr.length) {
      return NO_BOOKS_FOUND;
    }
    return arr;
  }

  if (!books?.length) {
    return (fallback || NO_BOOKS_FOUND) as any;
  }

  return (
    <div class="relative overflow-x-clip rounded-lg bg-card pb-16">
      <input type="radio" id="tab-read" name="tabs" class="peer/read hidden" />
      <input type="radio" id="tab-want" name="tabs" class="peer/want hidden" />
      <input type="radio" id="tab-reading" name="tabs" class="peer/reading hidden" checked />

      <div class="mb-4 border-b border-border peer-checked/read:[&_label[for='tab-read']]:border-primary peer-checked/read:[&_label[for='tab-read']]:text-primary peer-checked/reading:[&_label[for='tab-reading']]:border-primary peer-checked/reading:[&_label[for='tab-reading']]:text-primary peer-checked/want:[&_label[for='tab-want']]:border-primary peer-checked/want:[&_label[for='tab-want']]:text-primary">
        <ul class="-mb-px flex flex-wrap text-center text-sm font-medium" role="tablist">
          <li class="me-2" role="presentation">
            <label
              for="tab-reading"
              role="tab"
              aria-selected="true"
              aria-controls="tab-reading-panel"
              class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Reading
            </label>
          </li>
          <li class="me-2" role="presentation">
            <label
              for="tab-want"
              role="tab"
              aria-selected="false"
              aria-controls="tab-want-panel"
              class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Want to Read
            </label>
          </li>
          <li class="me-2" role="presentation">
            <label
              for="tab-read"
              role="tab"
              aria-selected="false"
              aria-controls="tab-read-panel"
              class="inline-block cursor-pointer rounded-t-lg border-b-2 border-transparent p-4 text-xl text-gray-500 select-none hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Read
            </label>
          </li>
        </ul>
      </div>

      <div
        id="tab-read-panel"
        role="tabpanel"
        aria-labelledby="tab-read"
        class="mt-8 hidden peer-checked/read:block"
      >
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {orNoResults(
            (books ?? [])
              .filter((book) => book.status === BOOK_STATUS.FINISHED)
              .sort((a, b) => {
                // Sort by finishedAt date, most recent first
                // If finishedAt is null, put those books at the end
                if (!a.finishedAt && !b.finishedAt) return 0;
                if (!a.finishedAt) return 1;
                if (!b.finishedAt) return -1;
                return new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime();
              })
              .map((book) => <BookCard variant="dense" book={normalizeBookData(book)} />),
          )}
        </ul>
      </div>
      <div
        id="tab-reading-panel"
        role="tabpanel"
        aria-labelledby="tab-reading"
        class="mt-8 hidden peer-checked/reading:block"
      >
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {orNoResults(
            (books ?? [])
              .filter((book) => book.status === BOOK_STATUS.READING)
              .sort((a, b) => {
                // Sort by most recent progress update first
                // Fall back to startedAt, then createdAt for books without progress
                const aDate = a.bookProgress?.updatedAt || a.startedAt || a.createdAt;
                const bDate = b.bookProgress?.updatedAt || b.startedAt || b.createdAt;
                return new Date(bDate).getTime() - new Date(aDate).getTime();
              })
              .map((book) => <BookCard variant="dense" book={normalizeBookData(book)} />),
          )}
        </ul>
      </div>
      <div
        id="tab-want-panel"
        role="tabpanel"
        aria-labelledby="tab-want"
        class="mt-8 hidden peer-checked/want:block"
      >
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {orNoResults(
            (books ?? [])
              .filter((book) => book.status === BOOK_STATUS.WANTTOREAD)
              .map((book) => <BookCard variant="dense" book={normalizeBookData(book)} />),
          )}
        </ul>
      </div>
    </div>
  );
};
