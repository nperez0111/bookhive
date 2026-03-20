import { type FC } from "hono/jsx";
import { formatDistanceToNow } from "date-fns";
import { BOOK_STATUS, BOOK_STATUS_PAST_TENSE_MAP } from "../../constants";
import type { Book } from "../../types";
import { UserBlock } from "./cards";
import { BookCard, normalizeBookData } from "./BookCard";

export const BuzzSection: FC<{
  title: string;
  subtitle: string;
  books: Book[];
  didHandleMap: Record<string, string>;
  profileMap?: Record<string, { avatar?: string | null }>;
  /** Optional "View all" link; when authRequired, only shown when user is logged in */
  viewAllHref?: string;
  viewAllLabel?: string;
  viewAllAuthRequired?: boolean;
  user?: { did: string; handle: string };
}> = ({
  title,
  subtitle,
  books,
  didHandleMap,
  profileMap,
  viewAllHref,
  viewAllLabel = "View all",
  viewAllAuthRequired,
  user,
}) => {
  const showViewAll = viewAllHref && (!viewAllAuthRequired || (viewAllAuthRequired && user));

  return (
    <div class="mt-10 flex flex-col gap-2 px-4 sm:mt-12 sm:px-6 lg:mt-16 lg:px-8">
      <div class="mb-4 sm:mb-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl lg:tracking-tight">
              {title}
            </h2>
            <p class="mt-2 text-base text-slate-600 dark:text-slate-400 sm:mt-4 sm:text-lg">
              {subtitle}
            </p>
          </div>
          {showViewAll && (
            <a href={viewAllHref} class="text-primary shrink-0 text-sm hover:underline">
              {viewAllLabel}
            </a>
          )}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {books.map((book) => {
          const userHandle = didHandleMap[book.userDid] || book.userDid;
          const statusText =
            book.status && book.status in BOOK_STATUS_PAST_TENSE_MAP
              ? BOOK_STATUS_PAST_TENSE_MAP[book.status as keyof typeof BOOK_STATUS_PAST_TENSE_MAP]
              : book.status || BOOK_STATUS_PAST_TENSE_MAP[BOOK_STATUS.READING];
          const timeAgo = formatDistanceToNow(book.indexedAt, { addSuffix: true });

          return (
            <BookCard
              key={`${book.userDid}-${book.hiveId}`}
              variant="list"
              book={normalizeBookData(book)}
            >
              <UserBlock
                handle={userHandle}
                avatar={profileMap?.[book.userDid]?.avatar}
                size="sm"
              />
              <a href={`/books/${book.hiveId}`} class="mt-1 block text-sm">
                <span class="text-muted-foreground">{statusText} </span>
                <span class="text-foreground">{timeAgo}</span>
                {book.review && book.review.length > 0 && (
                  <span class="text-muted-foreground"> and reviewed it</span>
                )}
              </a>
            </BookCard>
          );
        })}
      </div>
    </div>
  );
};
