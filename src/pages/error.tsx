import { type FC } from "hono/jsx";

const ErrorIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="text-destructive mx-auto size-12 shrink-0"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const Error: FC<{
  message?: string;
  description?: string;
  statusCode?: number;
}> = ({ message = "Error occurred", description = "Sorry, an error occurred.", statusCode }) => (
  <main class="grid min-h-full place-items-center px-6 py-24 sm:py-32 lg:px-8">
    <div class="empty flex flex-col items-center justify-center gap-4 text-center">
      <ErrorIcon />
      {statusCode ? (
        <p class="text-muted-foreground text-base font-semibold">{statusCode}</p>
      ) : undefined}
      {message ? (
        <h1 class="text-foreground text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {message}
        </h1>
      ) : undefined}
      {description ? (
        <p class="text-muted-foreground max-w-md text-pretty text-sm sm:text-base">{description}</p>
      ) : undefined}
      <div class="mt-2 flex flex-wrap items-center justify-center gap-3">
        <a href="/" class="btn btn-primary min-h-10 min-w-10">
          Go back home
        </a>
        <a href="/support" class="btn btn-ghost min-h-10 min-w-10 text-sm">
          Contact support <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </div>
  </main>
);
