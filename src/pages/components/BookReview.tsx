import { type FC } from "hono/jsx";
import type { Book } from "../../types";
import { Card, CardBody } from "./cards";
import { BookCard, normalizeBookData } from "./BookCard";

export const BookReview: FC<{
  book: Book;
}> = ({ book }) => {
  return (
    <Card class="group">
      <CardBody class="flex gap-4">
        <BookCard variant="row" size="medium" book={normalizeBookData(book)} />
        <div class="min-w-0 flex-1">
          <p class="text-foreground py-2">{book.review}</p>
        </div>
      </CardBody>
    </Card>
  );
};
