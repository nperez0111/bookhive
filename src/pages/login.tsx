import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

export const Login: FC<{
  error?: string;
  handle?: string;
}> = ({ error, handle }) => (
  <div class="animate-fade relative flex min-h-full flex-col items-center justify-center px-6 py-12 duration-300 lg:px-8">
    <a
      href="/"
      data-tooltip="Back to home"
      data-tooltip-place="bottom-right"
      class="text-muted-foreground hover:text-foreground absolute top-4 left-4 z-20 flex items-center justify-center rounded-md p-2 lg:top-6 lg:left-6"
    >
      <span class="sr-only">Back to home</span>
      <svg
        class="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="2"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
        />
      </svg>
    </a>
    <button
      type="button"
      class="theme-toggle text-muted-foreground hover:text-foreground absolute top-4 right-4 z-20 rounded-md p-2 lg:top-6 lg:right-6"
      aria-label="Toggle dark mode"
      id="theme-toggle"
    >
      <svg
        class="size-5 dark:hidden"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M21.752 15.752A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.248z"
        />
      </svg>
      <svg
        class="hidden size-5 dark:block"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
        />
      </svg>
    </button>
    <Script
      script={(document) => {
        const btn = document.getElementById("theme-toggle");
        const updateThemeColor = () => {
          const meta = document.querySelector('meta[name="theme-color"]');
          if (meta) {
            meta.setAttribute(
              "content",
              document.documentElement.classList.contains("dark")
                ? "#1c1917"
                : "#d97706",
            );
          }
        };
        updateThemeColor();
        btn?.addEventListener("click", () => {
          const html = document.documentElement;
          const isDark = html.classList.toggle("dark");
          localStorage.setItem("theme", isDark ? "dark" : "light");
          updateThemeColor();
        });
      }}
    />
    <div class="relative w-full max-w-sm">
      <img
        src="/full_logo.jpg"
        alt="BookHive"
        class="absolute top-0 left-1/2 z-10 h-48 w-auto -translate-x-1/2 -translate-y-8 rounded-xl object-contain drop-shadow-lg"
      />
      <div class="card w-full overflow-visible pt-52">
        <header class="flex flex-col items-center gap-4">
          <h2 class="text-foreground text-center text-xl font-semibold tracking-tight">
            Buzz in to your account
          </h2>
        </header>

        <section>
          <form
            action="/login"
            method="post"
            class="form flex flex-col gap-6"
            id="login-form"
          >
            <div class="field">
              <label for="handle" class="label">
                Bluesky Handle
              </label>
              {error ? (
                <p class="text-destructive text-sm">
                  Error: <i>{error}</i>
                </p>
              ) : undefined}
              <actor-typeahead>
                <input
                  autofocus
                  id="handle"
                  type="text"
                  name="handle"
                  value={handle}
                  placeholder="Enter your handle (eg buzzer.bsky.social)"
                  required
                  class="input"
                />
              </actor-typeahead>
            </div>

            <button
              type="submit"
              class="btn w-full bg-amber-600 text-white shadow-xs hover:bg-amber-500 focus-visible:ring-amber-600"
            >
              Buzz in
            </button>
          </form>
        </section>

        <footer class="justify-center border-t pt-6">
          <p class="text-muted-foreground text-center text-sm">
            Don't have an account?
            <br />
            <a
              href="https://bsky.app"
              class="text-primary font-semibold hover:underline"
            >
              Sign up for Bluesky
            </a>{" "}
            to create one now!
          </p>
        </footer>
      </div>
    </div>
    <Script
      script={(document) => {
        const STORAGE_KEY = "bookhive_last_handle";
        const handleInput = document.getElementById(
          "handle",
        ) as HTMLInputElement;
        const loginForm = document.getElementById(
          "login-form",
        ) as HTMLFormElement;

        // Load stored handle on page load
        if (handleInput && !handleInput.value) {
          try {
            const storedHandle = localStorage.getItem(STORAGE_KEY);
            if (storedHandle) {
              handleInput.value = storedHandle;
            }
          } catch (error) {
            console.error("Failed to load stored handle:", error);
          }
        }

        // Save handle on form submit
        if (loginForm && handleInput) {
          loginForm.addEventListener("submit", function () {
            try {
              const handleValue = handleInput.value.trim();
              if (handleValue) {
                localStorage.setItem(STORAGE_KEY, handleValue);
              }
            } catch (error) {
              console.error("Failed to save handle:", error);
            }
          });
        }
      }}
    />
  </div>
);
