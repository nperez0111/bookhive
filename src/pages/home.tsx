/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";
import { type BookReview, type Book } from "../db";

function ts(status: BookReview) {
  const createdAt = new Date(status.createdAt);
  const indexedAt = new Date(status.indexedAt);
  if (createdAt < indexedAt) return createdAt.toDateString();
  return indexedAt.toDateString();
}

type Props = {
  latestReviews: BookReview[];
  didHandleMap: Record<string, string>;
  profile?: { displayName?: string };
  myBooks?: Book[];
};

export const Home: FC<Props> = ({
  latestReviews,
  didHandleMap,
  profile,
  myBooks,
}) => (
  <div id="root">
    <div class="error"></div>
    <div id="header">
      <h1>Bookhive</h1>
      <p>Buzz about your books!</p>
    </div>
    <div class="container">
      <div class="card">
        {profile ? (
          <form action="/logout" method="post" class="session-form">
            <div>
              Hi, <strong>{profile.displayName || "friend"}</strong>.
            </div>
            <div>
              <button type="submit">Log out</button>
            </div>
          </form>
        ) : (
          <div class="session-form">
            <div>
              <a href="/login">Log in</a> to set your status!
            </div>
            <div>
              <a href="/login" class="button">
                Log in
              </a>
            </div>
          </div>
        )}
      </div>
      {profile && (
        <form action="/refresh-books" method="get">
          <button
            class="block w-full rounded-md bg-indigo-600 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            type="submit"
          >
            Refresh books
          </button>
        </form>
      )}
      {profile && (
        <form action="/books" method="post">
          <div class="space-y-12">
            <div class="border-b border-gray-900/10 pb-12">
              <div class="sm:col-span-4">
                <label
                  for="title"
                  class="block text-sm/6 font-medium text-gray-900"
                >
                  Title
                </label>
                <div class="mt-2">
                  <input
                    id="title"
                    name="title"
                    type="text"
                    class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6"
                  />
                </div>
              </div>
              <div class="sm:col-span-4">
                <label
                  for="author"
                  class="block text-sm/6 font-medium text-gray-900"
                >
                  Author
                </label>
                <div class="mt-2">
                  <input
                    id="author"
                    name="author"
                    type="text"
                    class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6"
                  />
                </div>
                <div class="sm:col-span-4">
                  <label
                    for="year"
                    class="block text-sm/6 font-medium text-gray-900"
                  >
                    Year Published
                  </label>
                  <div class="mt-2">
                    <input
                      id="year"
                      name="year"
                      type="number"
                      class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-6 flex items-center justify-end gap-x-6">
            <button type="button" class="text-sm/6 font-semibold text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Save
            </button>
          </div>
        </form>
      )}
      <div>
        Your books
        {JSON.stringify(myBooks)}
      </div>
      {latestReviews.map((review) => {
        const handle = didHandleMap[review.authorDid] || review.authorDid;
        const date = ts(review);
        return (
          <div>
            <a class="author" href={`https://bsky.app/profile/${handle}`}>
              @${handle}
            </a>
            {JSON.stringify(review)} on {date}
          </div>
        );
      })}
    </div>
  </div>
);
