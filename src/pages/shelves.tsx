import type { FC } from "hono/jsx";
import type { BookListRow, HiveBook, HiveId, ProfileViewDetailed } from "../types";
import { FallbackCover } from "./components/fallbackCover";

type ShelfItem = {
  uri: string;
  cid: string;
  hiveId: HiveId | null;
  description: string | null;
  position: number | null;
  addedAt: string;
  embeddedTitle: string | null;
  embeddedAuthor: string | null;
  embeddedCoverUrl: string | null;
  identifiers: string | null;
  title: string | null;
  authors: string | null;
  thumbnail: string | null;
  cover: string | null;
  rating: number | null;
};

export const ShelfViewPage: FC<{
  list: BookListRow;
  items: ShelfItem[];
  handle: string;
  isOwner: boolean;
  profile: ProfileViewDetailed | null;
  searchQuery?: string;
  searchResults?: HiveBook[];
}> = ({ list, items, handle, isOwner, searchQuery = "", searchResults = [] }) => {
  const rkey = list.uri.split("/").at(-1)!;

  return (
    <div class="space-y-6 px-4 lg:px-8">
      {/* Header */}
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <a href={`/shelves/${handle}`} class="text-sm text-muted-foreground hover:text-primary">
              Shelves
            </a>
            <span class="text-muted-foreground">/</span>
          </div>
          <h1 class="mt-1 text-2xl font-bold text-foreground">{list.name}</h1>
          {list.description && <p class="mt-2 text-muted-foreground">{list.description}</p>}
          <div class="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            <a href={`/profile/${handle}`} class="hover:text-primary">
              @{handle}
            </a>
            <span>
              {items.length} {items.length === 1 ? "book" : "books"}
            </span>
            {Boolean(list.ordered) && <span class="badge badge-sm">Ranked</span>}
          </div>
        </div>

        {isOwner && (
          <div class="flex shrink-0 gap-2">
            <a href={`/shelves/${handle}/${rkey}/edit`} class="btn btn-ghost btn-sm">
              Edit
            </a>
            <form
              action={`/shelves/${handle}/${rkey}/delete`}
              method="post"
              onsubmit="return confirm('Delete this shelf and all its items?')"
            >
              <button type="submit" class="btn btn-destructive btn-sm">
                Delete
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Search to add books (owner only) */}
      {isOwner && (
        <div class="card">
          <div class="card-body space-y-3">
            <form action={`/shelves/${handle}/${rkey}`} method="get" class="flex gap-2">
              <div class="relative flex-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="search"
                  name="q"
                  value={searchQuery}
                  placeholder="Search for a book to add..."
                  class="input w-full pl-9"
                  autocomplete="off"
                />
              </div>
              <button type="submit" class="btn btn-primary btn-sm">
                Search
              </button>
            </form>

            {/* Search results */}
            {searchQuery && searchResults.length === 0 && (
              <p class="text-sm text-muted-foreground">No results found for "{searchQuery}".</p>
            )}
            {searchResults.length > 0 && (
              <div class="space-y-2">
                <p class="text-xs font-medium text-muted-foreground">
                  {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "
                  {searchQuery}"
                </p>
                {searchResults.map((book) => (
                  <div
                    key={book.id}
                    class="flex items-center gap-3 rounded-lg border border-border bg-background p-2"
                  >
                    <a href={`/books/${book.id}`} class="shrink-0">
                      {book.cover || book.thumbnail ? (
                        <img
                          src={book.cover || book.thumbnail}
                          alt={book.title}
                          class="h-16 w-11 rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <FallbackCover className="h-16 w-11" />
                      )}
                    </a>
                    <div class="min-w-0 flex-1">
                      <a
                        href={`/books/${book.id}`}
                        class="text-sm font-medium text-foreground hover:text-primary line-clamp-1"
                      >
                        {book.title}
                      </a>
                      <p class="text-xs text-muted-foreground line-clamp-1">
                        {book.authors.split("\t").join(", ")}
                      </p>
                      {book.rating && (
                        <div class="mt-0.5 flex items-center gap-1">
                          <svg class="h-3 w-3 fill-current text-accent" viewBox="0 0 24 24">
                            <path d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z" />
                          </svg>
                          <span class="text-xs text-muted-foreground">
                            {(book.rating / 1000).toFixed(1)}
                          </span>
                        </div>
                      )}
                    </div>
                    <form action={`/shelves/${handle}/${rkey}/add`} method="post" class="shrink-0">
                      <input type="hidden" name="hiveId" value={book.id} />
                      <button type="submit" class="btn btn-primary btn-sm">
                        Add
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Book list */}
      {items.length === 0 && !searchQuery ? (
        <div class="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <p class="text-lg text-muted-foreground">This shelf is empty.</p>
          {isOwner && (
            <p class="mt-2 text-sm text-muted-foreground">
              Use the search above to find and add books.
            </p>
          )}
        </div>
      ) : items.length === 0 ? null : (
        <div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {items.map((item, index) => {
            const bookTitle = item.title || item.embeddedTitle || "Unknown Book";
            const bookAuthor =
              item.authors?.split("\t")[0] || item.embeddedAuthor || "Unknown Author";
            const bookCover = item.cover || item.embeddedCoverUrl || item.thumbnail;
            const bookRating = item.rating ? (item.rating / 1000).toFixed(1) : null;

            const coverImg = bookCover ? (
              <img
                src={bookCover}
                alt={bookTitle}
                class="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <FallbackCover className="h-full w-full" />
            );

            return (
              <div key={item.uri} class="group relative">
                {/* Cover */}
                <div class="relative aspect-[2/3] w-full overflow-hidden rounded shadow-sm">
                  {item.hiveId ? (
                    <a href={`/books/${item.hiveId}`} class="block h-full w-full">
                      {coverImg}
                    </a>
                  ) : (
                    <div class="h-full w-full">{coverImg}</div>
                  )}

                  {/* Rank badge */}
                  {Boolean(list.ordered) && (
                    <div class="absolute top-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs font-bold text-white">
                      {index + 1}
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {item.hiveId ? (
                      <a
                        href={`/books/${item.hiveId}`}
                        class="text-xs font-semibold text-white line-clamp-2 hover:underline"
                      >
                        {bookTitle}
                      </a>
                    ) : (
                      <span class="text-xs font-semibold text-white line-clamp-2">{bookTitle}</span>
                    )}
                    <p class="mt-0.5 text-xs text-white/70 line-clamp-1">{bookAuthor}</p>
                    {bookRating && (
                      <div class="mt-1 flex items-center gap-0.5">
                        <svg class="h-3 w-3 fill-current text-yellow-400" viewBox="0 0 24 24">
                          <path d="M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18z" />
                        </svg>
                        <span class="text-xs text-white/70">{bookRating}</span>
                      </div>
                    )}
                    {item.description && (
                      <p class="mt-1 text-xs text-white/60 italic line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    {/* Remove button (owner only) */}
                    {isOwner && (
                      <form
                        action={`/shelves/${handle}/${rkey}/remove`}
                        method="post"
                        class="mt-1.5"
                      >
                        <input type="hidden" name="itemUri" value={item.uri} />
                        <button
                          type="submit"
                          class="rounded bg-destructive/80 px-1.5 py-0.5 text-xs text-white hover:bg-destructive"
                          title="Remove from shelf"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const ShelfCreatePage: FC = () => {
  return (
    <div class="mx-auto max-w-lg space-y-6 px-4 lg:px-8">
      <h1 class="text-2xl font-bold text-foreground">Create a Shelf</h1>
      <p class="text-muted-foreground">
        Organize your books into curated shelves to share with others.
      </p>

      <form action="/shelves/new" method="post" class="space-y-4">
        <div>
          <label for="shelf-name" class="mb-1 block text-sm font-medium text-foreground">
            Name
          </label>
          <input
            type="text"
            id="shelf-name"
            name="name"
            required
            maxLength={100}
            placeholder="e.g., Best Sci-Fi of 2025"
            class="input w-full"
          />
        </div>

        <div>
          <label for="shelf-description" class="mb-1 block text-sm font-medium text-foreground">
            Description <span class="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="shelf-description"
            name="description"
            maxLength={500}
            rows={3}
            placeholder="What's this shelf about?"
            class="input w-full"
            style={{ resize: "vertical" }}
          />
        </div>

        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="shelf-ordered"
            name="ordered"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <label for="shelf-ordered" class="text-sm text-foreground">
            This is a ranked list (books are numbered)
          </label>
        </div>

        <div class="flex gap-3 pt-2">
          <button type="submit" class="btn btn-primary">
            Create Shelf
          </button>
          <a href="/" class="btn btn-ghost">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
};

export const ShelfEditPage: FC<{
  list: BookListRow;
  handle: string;
}> = ({ list, handle }) => {
  const rkey = list.uri.split("/").at(-1)!;

  return (
    <div class="mx-auto max-w-lg space-y-6 px-4 lg:px-8">
      <h1 class="text-2xl font-bold text-foreground">Edit Shelf</h1>

      <form action={`/shelves/${handle}/${rkey}/edit`} method="post" class="space-y-4">
        <div>
          <label for="shelf-name" class="mb-1 block text-sm font-medium text-foreground">
            Name
          </label>
          <input
            type="text"
            id="shelf-name"
            name="name"
            required
            maxLength={100}
            value={list.name}
            class="input w-full"
          />
        </div>

        <div>
          <label for="shelf-description" class="mb-1 block text-sm font-medium text-foreground">
            Description <span class="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="shelf-description"
            name="description"
            maxLength={500}
            rows={3}
            class="input w-full"
            style={{ resize: "vertical" }}
          >
            {list.description || ""}
          </textarea>
        </div>

        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="shelf-ordered"
            name="ordered"
            checked={Boolean(list.ordered)}
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <label for="shelf-ordered" class="text-sm text-foreground">
            This is a ranked list (books are numbered)
          </label>
        </div>

        <div class="flex gap-3 pt-2">
          <button type="submit" class="btn btn-primary">
            Save Changes
          </button>
          <a href={`/shelves/${handle}/${rkey}`} class="btn btn-ghost">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
};
