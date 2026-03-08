import type { FC, Child } from "hono/jsx";
import { FallbackCover } from "../fallbackCover";
import { StarDisplay } from "./StarDisplay";
import { BOOK_STATUS_MAP } from "../../../constants";

const sizeMap = {
  compact: { cover: "h-16 w-12", titleClamp: "line-clamp-2", textSize: "text-sm" },
  small: { cover: "h-24 w-16", titleClamp: "line-clamp-2", textSize: "text-sm" },
  medium: { cover: "h-36 w-24", titleClamp: "line-clamp-2", textSize: "text-base" },
  coverOnly: { cover: "h-full w-full", titleClamp: "line-clamp-2", textSize: "text-md" },
} as const;

function authorsDisplay(authors: string): string {
  return authors?.replace(/\t/g, ", ") ?? "";
}

export const BookBlock: FC<{
  hiveId: string;
  title: string;
  authors: string;
  cover?: string | null;
  thumbnail?: string | null;
  size?: "compact" | "small" | "medium" | "coverOnly";
  stars?: number | null;
  status?: string | null;
  showStatus?: boolean;
  class?: string;
  children?: Child;
}> = ({
  hiveId,
  title,
  authors,
  cover,
  thumbnail,
  size = "compact",
  stars,
  status,
  showStatus = false,
  class: className,
  children,
}) => {
  const config = sizeMap[size];
  const rating = stars != null ? stars / 2 : 0;
  const statusLabel =
    showStatus && status != null && status in BOOK_STATUS_MAP
      ? BOOK_STATUS_MAP[status as keyof typeof BOOK_STATUS_MAP]
      : null;

  if (size === "coverOnly") {
    return (
      <a href={`/books/${hiveId}`} class={className ?? "block"}>
        {cover || thumbnail ? (
          <img
            src={cover || thumbnail || ""}
            alt={title}
            class={`book-cover rounded-lg object-cover ${config.cover}`}
            style={`--book-cover-name: book-cover-${hiveId}`}
            loading="lazy"
          />
        ) : (
          <FallbackCover
            className={`rounded-lg ${config.cover}`}
            style={`--book-cover-name: book-cover-${hiveId}`}
          />
        )}
        {children}
      </a>
    );
  }

  const coverEl =
    cover || thumbnail ? (
      <img
        src={cover || thumbnail || ""}
        alt=""
        class={`${config.cover} rounded object-cover shrink-0`}
      />
    ) : (
      <FallbackCover
        className={`${config.cover} shrink-0 rounded`}
        style={`--book-cover-name: book-cover-${hiveId}`}
      />
    );

  return (
    <div class={className ? `flex gap-3 min-w-0 ${className}` : "flex gap-3 min-w-0"}>
      <a href={`/books/${hiveId}`} class="shrink-0">
        {coverEl}
      </a>
      <div class="min-w-0 flex-1 flex flex-col justify-center">
        <a
          href={`/books/${hiveId}`}
          class={`text-foreground hover:text-primary font-semibold ${config.titleClamp} ${config.textSize}`}
        >
          {title}
        </a>
        <div class="text-muted-foreground text-xs mt-0.5">{authorsDisplay(authors)}</div>
        {(rating > 0 || statusLabel) && (
          <div class="mt-1 flex flex-wrap items-center gap-2">
            {rating > 0 && <StarDisplay rating={rating} size="sm" class="flex" />}
            {statusLabel && <span class="badge">{statusLabel}</span>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
