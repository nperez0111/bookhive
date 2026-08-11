import { formatDistanceToNow } from "date-fns";
import { type FC } from "hono/jsx";
import { BOOK_STATUS, BOOK_STATUS_MAP } from "../constants";
import type { UserBook } from "../types";
import { FallbackCover } from "./components/fallbackCover";
import { Script } from "./utils/script";

/**
 * Minimum-viable book detail page for a user's PDS record that doesn't have
 * (or can't yet resolve to) a `hive_book` row. Renders embedded title/authors
 * from the record itself, supports status/rating/review/progress edits, and
 * intentionally hides cross-references (genres, author links, recommendations,
 * comments) since we have no canonical book to link them to.
 *
 * Mounted from /profile/:handle/book/:rkey.
 */
export const UserBookInfo: FC<{
  userBook: UserBook;
  ownerHandle: string;
  isOwnProfile: boolean;
}> = ({ userBook, ownerHandle, isOwnProfile }) => {
  const rkey = userBook.uri.split("/").at(-1)!;
  const authors = userBook.authors.split("\t");
  const status = userBook.status ?? null;
  const statusLabel =
    status && status in BOOK_STATUS_MAP
      ? BOOK_STATUS_MAP[status as keyof typeof BOOK_STATUS_MAP]
      : status || "Want to Read";

  return (
    <div class="mx-auto max-w-4xl space-y-8">
      {/* ===== Hero ===== */}
      <div class="card">
        <div class="card-body">
          <div class="flex flex-col gap-6 md:flex-row md:gap-8">
            <div class="mx-auto w-48 shrink-0 md:mx-0 md:w-52">
              <FallbackCover className="aspect-2/3 w-full" />
            </div>

            <div class="flex-1">
              <h1
                class="mb-1 text-2xl font-bold md:text-3xl dark:text-gray-100"
                style="text-wrap: balance"
              >
                {userBook.title}
              </h1>
              <p class="mb-3 text-lg text-muted-foreground">by {authors.join(", ")}</p>

              <p class="mb-3 text-sm text-muted-foreground">
                {`${userBook.finishedAt ? "Finished" : userBook.startedAt ? "Started" : "Added"}: ${formatDistanceToNow(
                  userBook.finishedAt ?? userBook.startedAt ?? userBook.createdAt,
                  { addSuffix: true },
                )}`}
              </p>

              <p class="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                We don't have additional details for this book yet — it'll fill in once we can match
                it to our catalog.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Activity (owner only) ===== */}
      {isOwnProfile && (
        <div class="card">
          <div class="card-body space-y-6">
            <h2 class="text-xl font-bold text-foreground">Your Activity</h2>

            <form action="/books" method="post">
              <input type="hidden" name="bookUri" value={userBook.uri} />
              <input type="hidden" name="title" value={userBook.title} />
              <input type="hidden" name="authors" value={userBook.authors} />

              <div class="space-y-6">
                {/* Status */}
                <div>
                  <label
                    for="user-book-status"
                    class="mb-2 block text-sm font-semibold text-foreground"
                  >
                    Status
                  </label>
                  <select
                    id="user-book-status"
                    name="status"
                    class="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                  >
                    <option value="" selected={!status}>
                      No status — {statusLabel}
                    </option>
                    {[
                      { value: BOOK_STATUS.FINISHED, label: "Finished" },
                      { value: BOOK_STATUS.READING, label: "Reading" },
                      { value: BOOK_STATUS.WANTTOREAD, label: "Want to Read" },
                      { value: BOOK_STATUS.ABANDONED, label: "Abandoned" },
                    ].map((s) => (
                      <option key={s.value} value={s.value} selected={status === s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Owned */}
                <div class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="user-book-owned"
                    name="owned"
                    value="true"
                    checked={Boolean(userBook.owned)}
                    class="h-4 w-4 rounded border border-border text-primary focus:ring-primary"
                  />
                  <label for="user-book-owned" class="text-sm text-foreground">
                    I own this book
                  </label>
                </div>

                {/* Rating */}
                <div>
                  <label
                    for="user-book-stars"
                    class="mb-2 block text-sm font-semibold text-foreground"
                  >
                    Rating (out of 10)
                  </label>
                  <input
                    type="number"
                    id="user-book-stars"
                    name="stars"
                    min={0}
                    max={10}
                    step={1}
                    value={userBook.stars ?? ""}
                    class="w-24 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>

                {/* Review */}
                <div>
                  <label
                    for="user-book-review"
                    class="mb-2 block text-sm font-semibold text-foreground"
                  >
                    Review
                  </label>
                  <textarea
                    id="user-book-review"
                    name="review"
                    rows={4}
                    placeholder="What did you think?"
                    class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                  >
                    {userBook.review || ""}
                  </textarea>
                </div>

                {/* Reading dates */}
                <div class="flex flex-wrap items-center gap-4">
                  <div class="flex items-center gap-2">
                    <label class="text-sm font-semibold text-foreground" for="user-book-started">
                      Started
                    </label>
                    <input
                      type="date"
                      id="user-book-started"
                      name="startedAt"
                      value={
                        userBook.startedAt
                          ? new Date(userBook.startedAt).toISOString().slice(0, 10)
                          : ""
                      }
                      class="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-sm font-semibold text-foreground" for="user-book-finished">
                      Finished
                    </label>
                    <input
                      type="date"
                      id="user-book-finished"
                      name="finishedAt"
                      value={
                        userBook.finishedAt
                          ? new Date(userBook.finishedAt).toISOString().slice(0, 10)
                          : ""
                      }
                      class="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Reading progress */}
                <div>
                  <label class="mb-2 block text-sm font-semibold text-foreground">
                    Reading Progress
                  </label>
                  <div class="flex items-center gap-2">
                    <label class="text-sm text-muted-foreground" for="user-book-current-page">
                      Page
                    </label>
                    <input
                      type="number"
                      id="user-book-current-page"
                      name="currentPage"
                      value={userBook.bookProgress?.currentPage ?? ""}
                      min={0}
                      class="w-24 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                    <span class="text-muted-foreground">/</span>
                    <input
                      type="number"
                      id="user-book-total-page"
                      name="totalPages"
                      value={userBook.bookProgress?.totalPages ?? ""}
                      min={1}
                      class="w-24 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                      placeholder="Total"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  class="btn btn-primary w-full transition-[scale] duration-150 active:scale-[0.96] sm:w-auto"
                >
                  Save
                </button>
              </div>
            </form>

            {/* Delete */}
            <div class="border-t border-border pt-4">
              <button
                type="button"
                id="delete-user-book-btn"
                class="min-h-[40px] inline-flex cursor-pointer items-center text-xs text-muted-foreground hover:text-destructive"
              >
                Remove from library
              </button>
              <dialog
                id="delete-user-book-dialog"
                class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
              >
                <h3 class="mb-2 text-lg font-semibold">Remove book?</h3>
                <p class="mb-4 text-sm text-muted-foreground">
                  This will remove "{userBook.title}" from your library. This cannot be undone.
                </p>
                <div class="flex justify-end gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    onclick="this.closest('dialog').close()"
                  >
                    Cancel
                  </button>
                  <form
                    action={`/profile/${ownerHandle}/book/${rkey}/delete`}
                    method="post"
                    class="inline"
                  >
                    <button type="submit" class="btn btn-destructive">
                      Remove
                    </button>
                  </form>
                </div>
              </dialog>
              <Script
                script={(document) => {
                  const btn = document.getElementById("delete-user-book-btn");
                  const dialog = document.getElementById(
                    "delete-user-book-dialog",
                  ) as HTMLDialogElement;
                  btn?.addEventListener("click", () => dialog?.showModal());
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
