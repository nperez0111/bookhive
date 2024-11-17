/** @jsx createElement */
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";

export const Error: FC<{
  message?: string;
  description?: string;
  statusCode?: number;
}> = ({
  message = "Error occurred",
  description = "Sorry, an error occurred.",
  statusCode,
}) => (
  <main class="grid min-h-full place-items-center bg-white px-6 py-24 sm:py-32 lg:px-8">
    <div class="text-center">
      {statusCode ? (
        <p class="text-base font-semibold text-indigo-600">{statusCode}</p>
      ) : undefined}
      {message ? (
        <h1 class="mt-4 text-balance text-5xl font-semibold tracking-tight text-gray-900 sm:text-7xl">
          {message}
        </h1>
      ) : undefined}
      {description ? (
        <p class="mt-6 text-pretty text-lg font-medium text-gray-500 sm:text-xl/8">
          {description}
        </p>
      ) : undefined}
      <div class="mt-10 flex items-center justify-center gap-x-6">
        <a
          href="/"
          class="rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Go back home
        </a>
        <a href="/support" class="text-sm font-semibold text-gray-900">
          Contact support <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </div>
  </main>
);
