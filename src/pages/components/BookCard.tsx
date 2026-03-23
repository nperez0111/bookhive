import type { FC, Child } from "hono/jsx";
import type { Book, HiveBook } from "../../types";
import { BOOK_STATUS_MAP } from "../../constants";
import { FallbackCover } from "./fallbackCover";
import { StarDisplay } from "./cards/StarDisplay";

// --- Shared types ---

export type BookCardData = {
  hiveId: string | null;
  title: string;
  authors: string;
  cover?: string | null;
  thumbnail?: string | null;
  rating: number;
  status?: string | null;
  stars?: number | null;
  review?: string | null;
};

export function normalizeBookData(book: Book | HiveBook): BookCardData {
  const isUserBook = "hiveId" in book;
  const hiveId = isUserBook ? book.hiveId : book.id;
  const stars = isUserBook ? (book as Book).stars : null;
  const rating = stars != null ? stars / 2 : "rating" in book ? (book.rating || 0) / 1000 : 0;

  return {
    hiveId,
    title: book.title,
    authors: book.authors,
    cover: book.cover,
    thumbnail: book.thumbnail,
    rating,
    status: "status" in book ? (book as Book).status : null,
    stars,
    review: "review" in book ? (book as Book).review : null,
  };
}

export function authorsDisplay(authors: string): string {
  return authors?.replace(/\t/g, ", ") ?? "";
}

// --- Shared sub-components ---

export const CoverImage: FC<{ book: BookCardData; class?: string }> = ({
  book,
  class: className,
}) => {
  if (book.cover || book.thumbnail) {
    return (
      <img
        src={book.cover || book.thumbnail || ""}
        alt={book.title}
        class={`book-cover ${className ?? ""}`}
        style={book.hiveId ? `--book-cover-name: book-cover-${book.hiveId}` : undefined}
        loading="lazy"
      />
    );
  }
  return (
    <FallbackCover
      className={`book-cover ${className ?? ""}`}
      style={book.hiveId ? `--book-cover-name: book-cover-${book.hiveId}` : undefined}
    />
  );
};

/** Tooltip that appears above or below a book cover on hover. Must be inside a `group` parent. */
export const BookTooltip: FC<{
  book: BookCardData;
  position?: "top" | "bottom";
  showChips?: boolean;
}> = ({ book, position = "top", showChips = true }) => {
  const positionClasses =
    position === "top"
      ? "bottom-full left-1/2 pb-2 -translate-x-1/2"
      : "top-full left-1/2 pt-2 -translate-x-1/2";

  return (
    <div
      class={`pointer-events-none absolute z-20 w-48 text-left opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${positionClasses}`}
    >
      <div class="relative rounded-lg bg-card px-3 py-2 shadow-lg ring-1 ring-border">
        <h3 class="text-sm font-bold leading-tight text-foreground line-clamp-2">{book.title}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground line-clamp-1">
          By {authorsDisplay(book.authors)}
        </p>
        {book.rating > 0 && (
          <div class="mt-1 flex items-center gap-1.5">
            <StarDisplay rating={book.rating} size="sm" class="flex" />
            <span class="text-xs text-muted-foreground">{book.rating.toFixed(1)}</span>
          </div>
        )}
        {showChips && <StatusChips book={book} />}
        {/* Arrow with border */}
        {position === "top" ? (
          <div class="absolute top-full left-1/2 -translate-x-1/2">
            <div class="border-x-[6px] border-t-[6px] border-x-transparent border-t-border" />
            <div class="-mt-[7px] border-x-[5px] border-t-[5px] border-x-transparent border-t-card" />
          </div>
        ) : (
          <div class="absolute bottom-full left-1/2 -translate-x-1/2">
            <div class="border-x-[6px] border-b-[6px] border-x-transparent border-b-border" />
            <div class="-mt-[5px] border-x-[5px] border-b-[5px] border-x-transparent border-b-card" />
          </div>
        )}
      </div>
    </div>
  );
};

/** Small status/rated/reviewed chip badges */
export const StatusChips: FC<{ book: BookCardData }> = ({ book }) => {
  if (book.status == null && book.stars == null && book.review == null) return null;
  return (
    <div class="mt-1 flex flex-wrap gap-1">
      {book.status != null && book.status in BOOK_STATUS_MAP && (
        <span class="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
          {BOOK_STATUS_MAP[book.status as keyof typeof BOOK_STATUS_MAP]}
        </span>
      )}
      {book.stars != null && (
        <span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">rated</span>
      )}
      {book.review != null && (
        <span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          reviewed
        </span>
      )}
    </div>
  );
};

// --- Dense variant ---
// Cover + title below. Tooltip above on hover.

type DenseProps = {
  variant: "dense";
  book: BookCardData;
  class?: string;
  badge?: Child;
  overlay?: Child;
  tooltipPosition?: "top" | "bottom";
};

const DenseCard: FC<DenseProps> = ({
  book,
  class: className,
  badge,
  overlay,
  tooltipPosition = "top",
}) => {
  const href = book.hiveId ? `/books/${book.hiveId}` : undefined;
  const Tag = href ? "a" : "div";

  return (
    <div class={`relative ${className ?? ""}`}>
      <div class="group relative">
        <BookTooltip book={book} position={tooltipPosition} />

        <Tag
          {...(href ? { href } : {})}
          class="relative block aspect-[2/3] w-full overflow-hidden rounded-lg shadow-sm transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-md"
        >
          <CoverImage book={book} class="h-full w-full object-cover" />
          {badge}
          {overlay && (
            <div class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              {overlay}
            </div>
          )}
        </Tag>
      </div>

      {href ? (
        <a href={href} class="block">
          <h3
            class="book-title mt-2 text-sm font-semibold leading-tight text-foreground line-clamp-2"
            style={book.hiveId ? `--book-title-name: book-title-${book.hiveId}` : undefined}
          >
            {book.title}
          </h3>
        </a>
      ) : (
        <h3 class="book-title mt-2 text-sm font-semibold leading-tight text-foreground line-clamp-2">
          {book.title}
        </h3>
      )}
    </div>
  );
};

// --- List variant ---
// Cover + children below (user info, etc). Tooltip above on hover. No title shown inline.

type ListProps = {
  variant: "list";
  book: BookCardData;
  class?: string;
  children?: Child;
};

const ListCard: FC<ListProps> = ({ book, class: className, children }) => {
  return (
    <div class={`relative ${className ?? ""}`}>
      <div class="group relative">
        <BookTooltip book={book} position="top" showChips={false} />

        <a
          href={book.hiveId ? `/books/${book.hiveId}` : undefined}
          class="block overflow-hidden rounded-lg transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-lg"
        >
          <div class="aspect-[2/3] w-full">
            <CoverImage book={book} class="h-full w-full object-cover" />
          </div>
        </a>
      </div>
      {children && <div class="mt-2">{children}</div>}
    </div>
  );
};

// --- Row variant ---
// Horizontal: cover + title + author + rating. Children slot for extra content.

const rowSizeMap = {
  compact: { cover: "h-16 w-12", titleClamp: "line-clamp-2", textSize: "text-sm" },
  small: { cover: "h-24 w-16", titleClamp: "line-clamp-2", textSize: "text-sm" },
  medium: { cover: "h-36 w-24", titleClamp: "line-clamp-2", textSize: "text-base" },
} as const;

type RowProps = {
  variant: "row";
  book: BookCardData;
  size?: "compact" | "small" | "medium";
  class?: string;
  showStatus?: boolean;
  children?: Child;
};

const RowCard: FC<RowProps> = ({
  book,
  size = "compact",
  class: className,
  showStatus = false,
  children,
}) => {
  const config = rowSizeMap[size];
  const statusLabel =
    showStatus && book.status != null && book.status in BOOK_STATUS_MAP
      ? BOOK_STATUS_MAP[book.status as keyof typeof BOOK_STATUS_MAP]
      : null;

  return (
    <div class={`flex gap-3 min-w-0 ${className ?? ""}`}>
      <a href={book.hiveId ? `/books/${book.hiveId}` : undefined} class="shrink-0">
        <CoverImage book={book} class={`${config.cover} rounded object-cover shrink-0`} />
      </a>
      <div class="min-w-0 flex-1 flex flex-col justify-center">
        <a
          href={book.hiveId ? `/books/${book.hiveId}` : undefined}
          class={`text-foreground hover:text-primary font-semibold ${config.titleClamp} ${config.textSize}`}
        >
          {book.title}
        </a>
        <div class="text-muted-foreground text-xs mt-0.5">{authorsDisplay(book.authors)}</div>
        {(book.rating > 0 || statusLabel) && (
          <div class="mt-1 flex flex-wrap items-center gap-2">
            {book.rating > 0 && <StarDisplay rating={book.rating} size="sm" class="flex" />}
            {statusLabel && <span class="badge">{statusLabel}</span>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

// --- Unified export ---

type BookCardProps = DenseProps | ListProps | RowProps;

export const BookCard: FC<BookCardProps> = (props) => {
  switch (props.variant) {
    case "dense":
      return <DenseCard {...props} />;
    case "list":
      return <ListCard {...props} />;
    case "row":
      return <RowCard {...props} />;
  }
};
