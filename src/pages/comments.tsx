import type { ProfileViewDetailed } from "../types";
import { useRequestContext } from "hono/jsx-renderer";
import type { NotNull } from "kysely";
import type { HiveBook } from "../types";
import type { HiveId } from "../types";
import { getProfiles } from "../utils/getProfile";
import { formatDistanceToNow } from "date-fns";
import { endTime, startTime } from "hono/timing";
import type { PropsWithChildren } from "hono/jsx";
import { Card, CardBody, UserBlock, StarDisplay, CardActions } from "./components/cards";
import { Script } from "./utils/script";
import { parseHtmlToText } from "../utils/htmlToText";

type CommentShape = {
  parentUri?: string;
  comment: string;
  cid: string;
  uri: string;
  userDid: string;
  createdAt: string;
  stars?: number | null;
};

function CommentForm({
  parentUri,
  parentCid,
  bookId,
}: {
  parentUri: string;
  parentCid: string;
  bookId: string;
}) {
  return (
    <form action="/comments" method="post" class="mt-4 space-y-4">
      <input type="hidden" name="parentUri" value={parentUri} />
      <input type="hidden" name="parentCid" value={parentCid} />
      <input type="hidden" name="hiveId" value={bookId} />

      <div class="field">
        <textarea
          name="comment"
          rows={3}
          class="input textarea w-full"
          placeholder="Write a reply..."
          required
        />
      </div>

      <div class="flex justify-end">
        <button type="submit" class="btn btn-primary">
          Reply
        </button>
      </div>
    </form>
  );
}

function Comment({
  comment,
  profiles,
  comments,
  bookId,
  did,
}: {
  comment: CommentShape;
  profiles: ProfileViewDetailed[];
  comments: CommentShape[];
  bookId: HiveId;
  did?: string | null;
}) {
  const profile = profiles.find((p) => p.did === comment.userDid);
  const subComments = comments.filter((c) => c.parentUri === comment.uri);
  const rkey = comment.uri.split("/").pop() ?? "";
  const commentIdSafe = rkey.replace(/[^a-zA-Z0-9-]/g, "-");
  const reviewLinkPath = `/books/${bookId}?review-id=${encodeURIComponent(comment.uri)}`;
  const shareUrl = reviewLinkPath;

  const handle = profile?.handle ?? comment.userDid;
  const timeAgo = formatDistanceToNow(comment.createdAt, { addSuffix: true });

  return (
    <article id={`comment-${commentIdSafe}`} class="mb-4" data-review-uri={comment.uri}>
      <Card>
        <CardBody>
          <UserBlock
            handle={handle}
            displayName={profile?.displayName ?? null}
            avatar={profile?.avatar ?? null}
            size="sm"
            suffix={timeAgo}
          />
          <time pubdate datetime={comment.createdAt} class="sr-only">
            {timeAgo}
          </time>

          <div class="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{timeAgo}</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-[0.7rem] font-medium text-muted-foreground hover:text-foreground"
              data-copy-path={reviewLinkPath}
            >
              Copy link
            </button>
          </div>

          {comment.stars != null && (
            <div class="mb-2 flex items-center gap-2">
              <StarDisplay rating={comment.stars / 2} size="sm" />
              <span class="text-muted-foreground text-sm">{comment.stars / 2}/5</span>
            </div>
          )}

          <input type="checkbox" id={`comments-toggle-${commentIdSafe}`} class="peer hidden" />
          <div class="peer-checked:invisible peer-checked:mb-0 peer-checked:h-0 peer-checked:opacity-0">
            <p class="whitespace-pre-wrap text-foreground">
              {parseHtmlToText(comment.comment)}
            </p>
          </div>

          <CardActions class="relative mt-3 flex-wrap">
            <input type="checkbox" id={`reply-${commentIdSafe}`} class="peer hidden" />
            {Boolean(did) && (
              <label
                htmlFor={`reply-${commentIdSafe}`}
                class="btn btn-ghost btn-sm cursor-pointer"
                tabindex={0}
                role="button"
                aria-controls={`form-${commentIdSafe}`}
              >
                Reply
              </label>
            )}

            <label
              htmlFor={`comments-toggle-${commentIdSafe}`}
              class="btn btn-ghost btn-sm cursor-pointer"
            >
              {subComments.length} replies
              <svg
                class="ml-1 h-4 w-4"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  clip-rule="evenodd"
                  fill-rule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                />
              </svg>
            </label>

            <button
              type="button"
              class="btn btn-ghost btn-sm"
              data-url={shareUrl}
              onclick="const el = this; const url = el.getAttribute('data-url'); if (url) { navigator.clipboard.writeText(window.location.origin + url); const t = el.textContent; el.textContent = 'Copied!'; setTimeout(() => el.textContent = t, 2000); }"
            >
              Share this review
            </button>

            {did === comment.userDid && (
              <>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm text-destructive hover:bg-destructive/10"
                  onclick={`document.getElementById('delete-dialog-${commentIdSafe}').showModal()`}
                >
                  Delete
                </button>
                <dialog
                  id={`delete-dialog-${commentIdSafe}`}
                  class="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
                >
                  <h3 class="mb-2 text-lg font-semibold">Delete review?</h3>
                  <p class="text-muted-foreground mb-4">This cannot be undone.</p>
                  <div class="flex justify-end gap-2">
                    <button
                      type="button"
                      class="btn btn-ghost"
                      onclick="this.closest('dialog').close()"
                    >
                      Cancel
                    </button>
                    <form action={`/comments/${rkey}`} method="post" class="inline">
                      <input type="hidden" name="_method" value="DELETE" />
                      <button type="submit" class="btn btn-destructive">
                        Delete
                      </button>
                    </form>
                  </div>
                </dialog>
              </>
            )}

            <div class="invisible mt-4 h-0 w-full opacity-0 transition-all duration-200 peer-checked:visible peer-checked:h-auto peer-checked:opacity-100">
              <CommentForm parentUri={comment.uri} parentCid={comment.cid} bookId={bookId} />
            </div>
          </CardActions>

          <div
            id={`comments-${commentIdSafe}`}
            class="visible mt-4 h-auto pl-0 opacity-100 transition-all duration-200 peer-checked:invisible peer-checked:mb-0 peer-checked:h-0 peer-checked:opacity-0"
          >
            {subComments.length > 0 && (
              <div class="mt-4 space-y-4 border-l-2 border-border pl-4">
                {subComments.map((sub) => (
                  <Comment
                    comment={sub}
                    profiles={profiles}
                    comments={comments}
                    bookId={bookId}
                    did={did}
                  />
                ))}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </article>
  );
}

export async function CommentsSection({
  book,
  children,
  did,
  reviewId,
}: PropsWithChildren<{
  book: HiveBook;
  did?: string | null;
  reviewId?: string;
}>) {
  const c = useRequestContext();

  startTime(c, "comments_top_level_reviews");
  const topLevelReviews = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .select([
      "user_book.review as comment",
      "user_book.createdAt",
      "user_book.stars",
      "user_book.userDid",
      "user_book.uri",
      "user_book.cid",
    ])
    .where("user_book.hiveId", "=", book.id)
    .where("user_book.review", "is not", null)
    .$narrowType<{ comment: NotNull }>()
    .orderBy("user_book.createdAt", "desc")
    .limit(1000)
    .execute();
  endTime(c, "comments_top_level_reviews");

  startTime(c, "comments_buzz");
  const comments = await c
    .get("ctx")
    .db.selectFrom("buzz")
    .select([
      "buzz.comment",
      "buzz.createdAt",
      "buzz.userDid",
      "buzz.parentUri",
      "buzz.cid",
      "buzz.uri",
    ])
    .where("buzz.hiveId", "=", book.id)
    .orderBy("buzz.createdAt", "desc")
    .limit(3000)
    .execute();
  endTime(c, "comments_buzz");

  startTime(c, "fetch_profiles");
  const profiles = await getProfiles({
    ctx: c.get("ctx"),
    dids: comments.map((c) => c.userDid).concat(topLevelReviews.map((r) => r.userDid)),
  });
  endTime(c, "fetch_profiles");

  return (
    <div class="card">
      <div class="card-body">
        {children}
        {reviewId && (
          <p class="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Viewing one review.</span>
            <a href={`/books/${book.id}`} class="font-medium text-primary hover:underline">
              See all reviews
            </a>
          </p>
        )}
        {topLevelReviews.map((review) => (
          <Comment
            comment={review}
            profiles={profiles}
            comments={comments}
            bookId={book.id}
            did={did}
          />
        ))}
        <Script
          script={(document) => {
            const reviewIdParam = new URLSearchParams(document.location.search).get("review-id");
            if (reviewIdParam) {
              document.querySelectorAll("[data-review-uri]").forEach((el) => {
                if (el.getAttribute("data-review-uri") === reviewIdParam) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-primary", "ring-offset-2");
                }
              });
            }
            document.querySelectorAll<HTMLButtonElement>("[data-copy-path]").forEach((btn) => {
              btn.addEventListener("click", (e) => {
                const path = btn.getAttribute("data-copy-path");
                if (path && navigator.clipboard?.writeText) {
                  e.preventDefault();
                  void navigator.clipboard.writeText(document.location.origin + path).then(() => {
                    const orig = btn.textContent;
                    btn.textContent = "Copied!";
                    setTimeout(() => {
                      btn.textContent = orig;
                    }, 1500);
                  });
                }
              });
            });
          }}
        />
      </div>
    </div>
  );
}
