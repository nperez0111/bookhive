import { type FC } from "hono/jsx";
import type { Book } from "../../types";
import { Card, CardBody, BookBlock } from "./cards";

export const BookReview: FC<{
  book: Book;
}> = ({ book }) => {
  return (
    <Card class="group">
      <CardBody class="flex gap-4">
        <BookBlock
          hiveId={book.hiveId}
          title={book.title}
          authors={book.authors}
          cover={book.cover}
          thumbnail={book.thumbnail}
          size="medium"
          stars={book.stars}
        />
        <div class="min-w-0 flex-1">
          <p class="text-foreground py-2">{book.review}</p>
        </div>
      </CardBody>
    </Card>
  );
};
