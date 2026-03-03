import { type FC } from "hono/jsx";
import { formatDistanceToNow } from "date-fns";
import { BOOK_STATUS, BOOK_STATUS_PAST_TENSE_MAP } from "../../constants";
import { FallbackCover } from "./fallbackCover";
import type { Book } from "../../types";
import { Card, CardBody, UserBlock, StarDisplay } from "./cards";

export const BuzzSection: FC<{
  title: string;
  subtitle: string;
  books: Book[];
  didHandleMap: Record<string, string>;
}> = ({ title, subtitle, books, didHandleMap }) => {
  return (
    <div class="mt-10 flex flex-col gap-2 px-4 sm:mt-12 sm:px-6 lg:mt-16 lg:px-8">
      <div class="mb-4 sm:mb-6">
        <h2 class="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl lg:tracking-tight">
          {title}
        </h2>
        <p class="mt-2 text-base text-slate-600 dark:text-slate-400 sm:mt-4 sm:text-lg">
          {subtitle}
        </p>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {books.map((book) => (
          <BuzzBook
            key={`${book.userDid}-${book.hiveId}`}
            book={book}
            userHandle={didHandleMap[book.userDid] || book.userDid}
          />
        ))}
      </div>
    </div>
  );
};

export const BuzzBook: FC<{
  book: Book;
  userHandle: string;
}> = ({ book, userHandle }) => {
  const statusText =
    book.status && book.status in BOOK_STATUS_PAST_TENSE_MAP
      ? BOOK_STATUS_PAST_TENSE_MAP[
          book.status as keyof typeof BOOK_STATUS_PAST_TENSE_MAP
        ]
      : book.status ||
        BOOK_STATUS_PAST_TENSE_MAP[BOOK_STATUS.READING];
  const timeAgo = formatDistanceToNow(book.indexedAt, { addSuffix: true });

  return (
    <Card class="group overflow-hidden p-0">
      <a
        href={`/books/${book.hiveId}`}
        class="block h-72 w-full transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg"
      >
        {book.cover || book.thumbnail ? (
          <img
            src={`${book.cover || book.thumbnail || ""}`}
            alt={book.title}
            class="book-cover h-full w-full object-cover"
            style={`--book-cover-name: book-cover-${book.hiveId}`}
          />
        ) : (
          <FallbackCover
            className="book-cover h-full w-full rounded-none"
            style={`--book-cover-name: book-cover-${book.hiveId}`}
          />
        )}
      </a>
      <CardBody class="mt-0 pt-4">
        <a href={`/books/${book.hiveId}`} class="block cursor-pointer">
          <h5
            class="book-title line-clamp-2 text-xl font-semibold tracking-tight text-foreground"
            style={`--book-title-name: book-title-${book.hiveId}`}
          >
            {book.title}
          </h5>
          {book.stars != null && book.stars > 0 && (
            <div class="mt-1 flex items-center gap-2">
              <StarDisplay rating={book.stars / 2} size="sm" />
              <span class="text-muted-foreground text-sm">{book.stars / 2}/5</span>
            </div>
          )}
        </a>
        <div class="mt-2">
          <UserBlock
            handle={userHandle}
            size="sm"
          />
        </div>
        <a href={`/books/${book.hiveId}`} class="mt-1 block text-sm">
          <span class="text-muted-foreground">{statusText} </span>
          <span class="text-foreground">{timeAgo}</span>
          {book.review && book.review.length > 0 && (
            <span class="text-muted-foreground"> and reviewed it</span>
          )}
        </a>
      </CardBody>
    </Card>
  );
};
