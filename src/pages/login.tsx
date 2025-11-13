import { type FC } from "hono/jsx";

export const Login: FC<{
  error?: string;
  handle?: string;
}> = ({ error, handle }) => (
  <div class="flex min-h-full flex-col justify-center px-6 py-12 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-sm">
      <div class="flex justify-center">
        <img
          src="/public/full_logo.jpg"
          alt="BookHive Logo"
          class="h-64 rounded-md"
        />
      </div>

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
            <actor-typeahead>
              <input
                autofocus
                id="handle"
                type="text"
                name="handle"
                value={handle}
                placeholder="Enter your handle (eg buzzer.bsky.social)"
                required
                class="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-xs ring-1 ring-gray-300 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-yellow-800 focus:ring-inset sm:text-sm/6 dark:bg-zinc-800 dark:text-gray-50 dark:ring-gray-700"
              />
            </actor-typeahead>
          </div>
        </div>

        <div>
          <button
            type="submit"
            class="flex w-full cursor-pointer justify-center rounded-md bg-yellow-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-yellow-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
          >
            Buzz in
          </button>
        </div>
      </form>

      <p class="mt-10 text-center text-sm/6 text-gray-500">
        Don't have an account?
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
