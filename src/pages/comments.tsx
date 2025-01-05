import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { useRequestContext } from "hono/jsx-renderer";
import type { NotNull } from "kysely";
import type { HiveBook } from "../db";
import { getProfiles } from "../utils/getProfile";
import { formatDistanceToNow } from "date-fns";

function Comment({
  comment,
  profiles,
  comments,
}: {
  comment: {
    comment: string;
    uri: string;
    userDid: string;
    createdAt: string;
  };
  profiles: ProfileViewDetailed[];
  comments: {
    parentUri: string;
    comment: string;
    uri: string;
    userDid: string;
    createdAt: string;
  }[];
}) {
  const profile = profiles.find((p) => p.did === comment.userDid);

  const subComments = comments.filter((c) => c.parentUri === comment.uri);

  return (
    <div class="mb-5">
      <footer class="mb-2 flex items-center justify-between">
        <div class="flex items-center">
          <p class="mr-3 inline-flex items-center text-sm font-semibold text-gray-900 dark:text-white">
            <img
              class="mr-2 h-6 w-6 rounded-full"
              src={profile?.avatar}
              alt={profile?.displayName}
            />
            @{profile?.handle}
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            <time pubdate datetime={comment.createdAt}>
              {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
            </time>
          </p>
        </div>
      </footer>
      <p class="mb-2 text-gray-900 dark:text-white">{comment.comment}</p>
      <a
        href="#"
        class="text-primary-700 dark:text-primary-500 inline-flex items-center text-xs font-medium sm:text-sm"
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
      </a>
      {subComments.length === 0 ? null : (
        <article class="my-5 pl-12">
          {subComments.map((comment) => {
            return (
              <Comment
                comment={comment}
                profiles={profiles}
                comments={comments}
              ></Comment>
            );
          })}
        </article>
      )}
    </div>
  );
}

export async function CommentsPage({ book }: { book: HiveBook }) {
  const c = useRequestContext();

  const topLevelReviews = await c
    .get("ctx")
    .db.selectFrom("user_book")
    .select(["review as comment", "createdAt", "userDid", "uri"])
    .where("user_book.hiveId", "=", book.id)
    .where("user_book.review", "is not", null)
    .$narrowType<{ comment: NotNull }>()
    .orderBy("user_book.createdAt", "desc")
    .limit(1000)
    .execute();
  const comments = await c
    .get("ctx")
    .db.selectFrom("buzz")
    .leftJoin("user_book", "buzz.parentUri", "user_book.uri")
    .select([
      "buzz.comment",
      "buzz.createdAt",
      "buzz.userDid",
      "buzz.parentUri",
      "buzz.uri",
      "user_book.review as originalReview",
      "user_book.userDid as originalUserDid",
      "user_book.createdAt as originalCreatedAt",
    ])
    .where("buzz.hiveId", "=", book.id)
    .orderBy("buzz.createdAt", "desc")
    .limit(3000)
    .execute();

  const profiles = await getProfiles({
    ctx: c.get("ctx"),
    dids: comments
      .map((c) => c.userDid)
      .concat(topLevelReviews.map((r) => r.userDid)),
  });

  return (
    <div class="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-xs sm:p-6 xl:mb-0 dark:border-gray-700 dark:bg-gray-800">
      {topLevelReviews.map((review) => (
        <Comment
          comment={review}
          profiles={profiles}
          comments={comments}
        ></Comment>
      ))}
    </div>
  );
}
