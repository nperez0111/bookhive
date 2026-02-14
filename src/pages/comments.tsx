import type { ProfileViewDetailed } from "../types";
import { useRequestContext } from "hono/jsx-renderer";
import type { NotNull } from "kysely";
import type { HiveBook } from "../types";
import type { HiveId } from "../types";
import { getProfiles } from "../utils/getProfile";
import { formatDistanceToNow } from "date-fns";
import { endTime, startTime } from "hono/timing";
import type { PropsWithChildren } from "hono/jsx";
import { Modal } from "./components/modal";

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

      <div>
        <textarea
          name="comment"
          rows={3}
          class="w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 dark:border-gray-600 dark:bg-zinc-700 dark:text-white"
          placeholder="Write a reply..."
          required
        ></textarea>
      </div>

      <div class="flex justify-end">
        <button
          type="submit"
          class="cursor-pointer rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:outline-none"
        >
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

  return (
    <div class="mb-3">
      <div class="mb-2 flex items-center justify-between">
        <div class="flex items-center">
          <a
            href={`/profile/${profile?.handle}`}
            class="mr-3 inline-flex items-center text-sm font-semibold text-gray-900 hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-400"
          >
            <img
              class="mr-2 h-6 w-6 rounded-full"
              src={profile?.avatar}
              alt={profile?.displayName}
            />
            @{profile?.handle}
          </a>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            <time pubdate datetime={comment.createdAt}>
              {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
            </time>
          </p>
        </div>
      </div>
      {comment.stars != null && (
        <div class="mb-2 flex items-center">
          <div class="flex items-center">
            {Array.from({ length: 5 }, (_, i) => (
              <svg
                key={i}
                class={`h-4 w-4 ${
                  i < comment.stars! / 2
                    ? "text-yellow-400"
                    : "text-gray-300 dark:text-gray-600"
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <span class="ml-2 text-sm text-gray-600 dark:text-gray-400">
            {comment.stars / 2}/5
          </span>
        </div>
      )}
      <input
        type="checkbox"
        id={`comments-${comment.uri}`}
        class="peer hidden"
      />
      <p class="mb-2 text-gray-900 peer-checked:invisible peer-checked:h-0 peer-checked:opacity-0 dark:text-white">
        {comment.comment.split("\r\n").map((line, index, array) => (
          <>
            {line}
            {index < array.length - 1 && <br />}
          </>
        ))}
      </p>

      <div class="relative inline">
        <input
          type="checkbox"
          id={`reply-${comment.uri}`}
          class="peer hidden"
        />
        {Boolean(did) && (
          <label
            htmlFor={`reply-${comment.uri}`}
            class="inline cursor-pointer pr-2 text-sm font-medium hover:text-blue-600 hover:underline dark:hover:text-blue-400"
            tabindex={0}
            role="button"
            aria-controls={`form-${comment.uri}`}
          >
            Reply
          </label>
        )}

        <label
          htmlFor={`comments-${comment.uri}`}
          class="inline-flex cursor-pointer items-center text-xs font-medium text-gray-600 sm:text-sm dark:text-gray-400"
        >
          {subComments.length} replies
          <svg
            class="ml-1 h-5 w-5"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              clip-rule="evenodd"
              fill-rule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            ></path>
          </svg>
        </label>
        {did === comment.userDid && (
          <Modal
            id={`delete-${comment.uri}`}
            className="mt-2 inline cursor-pointer rounded border border-red-500 px-2 py-1 text-sm text-red-500 hover:bg-red-600 hover:text-white dark:text-red-400 dark:hover:bg-red-600 dark:hover:text-white"
            button="Delete"
            containerClass="inline"
          >
            Are you sure you want to delete this comment?
            <form
              action={`/comments/${comment.uri.split("/").pop()}`}
              method="post"
              class="mt-4 space-y-4"
            >
              <input type="hidden" name="_method" value="DELETE" />
              <input type="hidden" name="commentId" value={comment.uri} />
              <input type="hidden" name="hiveId" value={bookId} />
              <div class="flex justify-end">
                <button
                  type="submit"
                  class="cursor-pointer rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none"
                >
                  Delete
                </button>
              </div>
            </form>
          </Modal>
        )}

        <div class="invisible mt-4 h-0 pl-3 opacity-0 transition-all duration-200 peer-checked:visible peer-checked:h-auto peer-checked:opacity-100">
          <CommentForm
            parentUri={comment.uri}
            parentCid={comment.cid}
            bookId={bookId}
          />
        </div>
      </div>
      <div
        id={"comments-" + comment.uri}
        class="visible mt-4 h-auto pl-3 opacity-100 transition-all duration-200 peer-checked:invisible peer-checked:h-0 peer-checked:opacity-0"
      >
        {subComments.length === 0 ? null : (
          <article class="my-5 pl-12">
            {subComments.map((comment) => {
              return (
                <Comment
                  comment={comment}
                  profiles={profiles}
                  comments={comments}
                  bookId={bookId}
                  did={did}
                ></Comment>
              );
            })}
          </article>
        )}
      </div>
    </div>
  );
}

export async function CommentsSection({
  book,
  children,
  did,
}: PropsWithChildren<{ book: HiveBook; did?: string | null }>) {
  const c = useRequestContext();
  startTime(c, "fetch_comments");

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

  endTime(c, "fetch_comments");

  startTime(c, "fetch_profiles");
  const profiles = await getProfiles({
    ctx: c.get("ctx"),
    dids: comments
      .map((c) => c.userDid)
      .concat(topLevelReviews.map((r) => r.userDid)),
  });
  endTime(c, "fetch_profiles");

  return (
    <div class="mb-4 rounded-lg border border-gray-200 bg-yellow-50 p-4 shadow-xs sm:p-6 xl:mb-0 dark:border-gray-700 dark:bg-zinc-900">
      {children}
      {topLevelReviews.map((review) => (
        <Comment
          comment={review}
          profiles={profiles}
          comments={comments}
          bookId={book.id}
          did={did}
        ></Comment>
      ))}
    </div>
  );
}
