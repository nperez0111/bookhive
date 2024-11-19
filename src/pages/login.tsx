/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";

export const Login: FC<{ error?: string }> = ({ error }) => (
  <div class="flex min-h-full flex-col justify-center px-6 py-12 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-sm">
      <div class="mx-auto h-10 w-auto text-center text-4xl">🐝</div>

      <h2 class="mt-10 text-center text-2xl/9 font-bold tracking-tight text-gray-900 dark:text-gray-50">
        Buzz in to your account
      </h2>
    </div>

    <div class="mt-10 sm:mx-auto sm:w-full sm:max-w-sm">
      <form action="/login" method="post" class="space-y-6">
        <div>
          <label
            for="handle"
            class="block text-sm/6 font-medium text-gray-900 dark:text-gray-50"
          >
            Bluesky Handle
          </label>
          {error ? (
            <p>
              Error: <i>${error}</i>
            </p>
          ) : undefined}
          <div class="mt-2">
            <input
              id="handle"
              type="text"
              name="handle"
              placeholder="Enter your handle (eg buzzer.bsky.social)"
              required
              class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm/6 dark:bg-slate-800 dark:text-gray-50 dark:ring-gray-700"
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            class="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Buzz in
          </button>
        </div>
      </form>

      <p class="mt-10 text-center text-sm/6 text-gray-500">
        Don't have an account on the Atmosphere?
        <br />
        <a
          href="https://bsky.app"
          class="font-semibold text-indigo-600 hover:text-indigo-500"
        >
          Sign up for Bluesky
        </a>{" "}
        to create one now!
      </p>
    </div>
  </div>
);
