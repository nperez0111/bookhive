import { raw } from "hono/html";
import { type FC } from "hono/jsx";
import { Script } from "./utils/script";
import { ThemeToggle, ThemeToggleScript } from "./components/ThemeToggle";
import { ArrowLeft } from "./components/icons";

export const Login: FC<{
  error?: string;
  handle?: string;
  signupUrl?: string;
}> = ({ error, handle, signupUrl = "/pds/signup" }) => (
  <div class="animate-fade relative flex min-h-full flex-col items-center justify-center px-6 py-12 duration-300 lg:px-8">
    <a
      href="/"
      data-tooltip="Back to home"
      data-tooltip-place="bottom-right"
      class="text-muted-foreground hover:text-foreground absolute top-4 left-4 z-20 flex min-h-10 min-w-10 items-center justify-center rounded-md p-2 transition-colors duration-150 lg:top-6 lg:left-6"
    >
      <span class="sr-only">Back to home</span>
      <ArrowLeft class="size-5" />
    </a>
    <ThemeToggle class="text-muted-foreground hover:text-foreground absolute top-4 right-4 z-20 min-h-10 min-w-10 rounded-md p-2 transition-colors duration-150 lg:top-6 lg:right-6" />
    <ThemeToggleScript />
    <div class="relative w-full max-w-sm">
      {/* The JPEG stays: it's also the default og:image and OAuth client `logo_uri`, which third-party consumers may not decode as WebP. */}
      <picture>
        <source type="image/webp" srcset="/full_logo-384.webp" />
        <img
          src="/full_logo.jpg"
          alt="BookHive"
          width="384"
          height="384"
          class="absolute top-0 left-1/2 z-10 h-48 w-auto -translate-x-1/2 -translate-y-8 rounded-xl object-contain drop-shadow-lg"
        />
      </picture>
      <div class="card w-full overflow-visible border-0 pt-52 shadow-md">
        <header class="flex flex-col items-center gap-4">
          <h2 class="text-foreground text-center text-xl font-semibold tracking-tight">
            Buzz in to your account
          </h2>
        </header>

        <section>
          <form action="/login" method="post" class="form flex flex-col gap-6" id="login-form">
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

            <button type="submit" class="btn btn-primary w-full">
              Buzz in
            </button>
          </form>
        </section>

        <footer class="justify-center border-t pt-6">
          <p class="text-muted-foreground text-center text-sm">
            Don't have an account?{" "}
            <a href={signupUrl} class="text-primary font-semibold hover:underline">
              {signupUrl === "/pds/signup"
                ? "Create a BookHive account"
                : "Create a Bluesky account"}
            </a>
            {signupUrl === "/pds/signup" && (
              <>
                <br />
                <span class="text-xs">
                  or sign in with an existing{" "}
                  <a href="https://bsky.app" class="text-primary hover:underline">
                    Bluesky
                  </a>{" "}
                  account
                </span>
              </>
            )}
          </p>
        </footer>
      </div>
    </div>
    <Script
      script={(document) => {
        const STORAGE_KEY = "bookhive_last_handle";
        const handleInput = document.getElementById("handle") as HTMLInputElement;
        const loginForm = document.getElementById("login-form") as HTMLFormElement;

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
    {/* Only used on this login form, so it's loaded here rather than globally in Layout. */}
    {raw(`<script type="module" src="/js/actor-typeahead.js"></script>`)}
  </div>
);
