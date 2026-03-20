import { type FC } from "hono/jsx";
import type { Book } from "../../types";
import { Card, CardBody } from "./cards";
import { BookTooltip, CoverImage, normalizeBookData } from "./BookCard";
import { StarDisplay } from "./cards/StarDisplay";
import { parseHtmlToText } from "../../utils/htmlToText";

export const BookReview: FC<{
  book: Book;
}> = ({ book }) => {
  const bookData = normalizeBookData(book);
  const communityRating = (book.rating || 0) / 1000;
  const tooltipData = { ...bookData, rating: communityRating };
  const rating = book.stars != null ? book.stars / 2 : null;

  return (
    <Card>
      <CardBody class="flex gap-4">
        <div class="flex shrink-0 flex-col items-center gap-1">
          <div class="group relative">
            <a href={`/book/${book.hiveId}`}>
              <CoverImage book={bookData} class="h-32 w-22 rounded object-cover" />
            </a>
            <BookTooltip book={tooltipData} position="top" />
          </div>
          <div class="flex w-full justify-center">
            <StarDisplay rating={rating ?? 0} size="md" />
          </div>
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="text-foreground whitespace-pre-wrap text-sm">
            {parseHtmlToText(book.review ?? "")}
          </p>
        </div>
      </CardBody>
    </Card>
  );
};
