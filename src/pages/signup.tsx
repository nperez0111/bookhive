import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

export const Signup: FC<{
  error?: string;
  email?: string;
  handle?: string;
}> = ({ error, email, handle }) => (
  <div class="animate-fade relative flex min-h-full flex-col items-center justify-center px-6 py-12 duration-300 lg:px-8">
    <a
      href="/"
      data-tooltip="Back to home"
      data-tooltip-place="bottom-right"
      class="text-muted-foreground hover:text-foreground absolute top-4 left-4 z-20 flex size-10 items-center justify-center rounded-md lg:top-6 lg:left-6"
    >
      <span class="sr-only">Back to home</span>
      <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
        />
      </svg>
    </a>
    <button
      type="button"
      class="theme-toggle text-muted-foreground hover:text-foreground absolute top-4 right-4 z-20 flex size-10 items-center justify-center rounded-md lg:top-6 lg:right-6"
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
              document.documentElement.classList.contains("dark") ? "#1c1917" : "#d97706",
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
            Create your account
          </h2>
          <p class="text-muted-foreground text-center text-sm">
            This creates a new Bluesky account hosted at{" "}
            <strong class="text-foreground">bookhive.social</strong>. If you already have a Bluesky
            account,{" "}
            <a href="/login" class="text-primary font-semibold hover:underline">
              sign in
            </a>{" "}
            instead.
          </p>
          <p class="text-muted-foreground text-center text-sm">
            By creating this account, bookhive.social will host and be responsible for your account
            data. You are free to migrate to another host at any time using{" "}
            <a
              href="https://pdsmoover.com/"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary font-semibold hover:underline"
            >
              PDS Moover
            </a>
            . For questions, reach out to{" "}
            <a
              href="mailto:computers@nickthesick.com"
              class="text-primary font-semibold hover:underline"
            >
              computers@nickthesick.com
            </a>
            .
          </p>
        </header>

        <section>
          <form
            action="/pds/signup"
            method="post"
            enctype="multipart/form-data"
            class="form flex flex-col gap-5"
            id="signup-form"
          >
            {error ? (
              <p class="text-destructive text-sm">
                Error: <i>{error}</i>
              </p>
            ) : undefined}

            <div class="flex flex-col items-center gap-2">
              <button
                type="button"
                id="avatar-btn"
                class="group relative size-20 overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-100 transition-colors hover:border-amber-500 dark:border-gray-600 dark:bg-gray-800"
                aria-label="Upload profile photo"
              >
                <img
                  id="avatar-preview"
                  src=""
                  alt=""
                  class="absolute inset-0 hidden size-full object-cover"
                />
                <span
                  id="avatar-placeholder"
                  class="flex size-full flex-col items-center justify-center gap-1"
                >
                  <svg
                    class="size-7 text-gray-400 group-hover:text-amber-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                    />
                  </svg>
                </span>
                <span
                  class="absolute inset-0 hidden items-center justify-center rounded-full bg-black/40 group-hover:flex"
                  id="avatar-overlay"
                >
                  <svg
                    class="size-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.04l-.821 1.315z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                    />
                  </svg>
                </span>
              </button>
              <span class="text-muted-foreground text-xs">Profile photo (optional)</span>
              <input
                id="avatar-input"
                type="file"
                name="avatar"
                accept="image/png,image/jpeg"
                class="hidden"
              />
            </div>

            <div class="field">
              <label for="email" class="label">
                Email
              </label>
              <input
                autofocus
                id="email"
                type="email"
                name="email"
                value={email}
                placeholder="you@example.com"
                required
                class="input"
              />
            </div>

            <div class="field">
              <label for="handle" class="label">
                Handle
              </label>
              <div class="flex items-stretch">
                <input
                  id="handle"
                  type="text"
                  name="handle"
                  value={handle}
                  placeholder="yourname"
                  required
                  pattern="[a-zA-Z0-9\-]{3,20}"
                  title="3-20 characters, letters, numbers, and hyphens only"
                  class="input rounded-r-none border-r-0"
                />
                <span class="bg-muted text-muted-foreground inline-flex items-center rounded-r-md border px-3 text-sm">
                  .bookhive.social
                </span>
              </div>
            </div>

            <div class="field">
              <label for="password" class="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                name="password"
                placeholder="At least 8 characters"
                required
                minlength={8}
                class="input"
              />
            </div>

            <div class="field">
              <label for="confirmPassword" class="label">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                placeholder="Re-enter your password"
                required
                minlength={8}
                class="input"
              />
            </div>

            <p class="text-muted-foreground rounded-md bg-card shadow-sm px-3 py-2 text-xs">
              After your account is created, you'll be asked to sign in with the password you just
              chose. Have it ready!
            </p>

            <button
              type="submit"
              class="btn w-full bg-amber-600 text-white shadow-xs hover:bg-amber-500 focus-visible:ring-amber-600"
            >
              Create account
            </button>

            <p class="text-muted-foreground text-center text-xs">
              By creating an account you agree to our{" "}
              <a href="/legal" class="text-primary hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy-policy" class="text-primary hover:underline">
                Privacy Policy
              </a>
              .
            </p>
          </form>
        </section>

        <footer class="justify-center border-t pt-6">
          <p class="text-muted-foreground text-center text-sm">
            Already have an account?{" "}
            <a href="/login" class="text-primary font-semibold hover:underline">
              Buzz in
            </a>
          </p>
        </footer>
      </div>
    </div>
    <Script
      script={(document) => {
        const form = document.getElementById("signup-form") as HTMLFormElement;
        const password = document.getElementById("password") as HTMLInputElement;
        const confirm = document.getElementById("confirmPassword") as HTMLInputElement;

        form?.addEventListener("submit", (e) => {
          if (password.value !== confirm.value) {
            e.preventDefault();
            confirm.setCustomValidity("Passwords do not match");
            confirm.reportValidity();
          }
        });

        confirm?.addEventListener("input", () => {
          confirm.setCustomValidity("");
        });

        // Avatar picker
        const avatarBtn = document.getElementById("avatar-btn") as HTMLButtonElement;
        const avatarInput = document.getElementById("avatar-input") as HTMLInputElement;
        const avatarPreview = document.getElementById("avatar-preview") as HTMLImageElement;
        const avatarPlaceholder = document.getElementById("avatar-placeholder") as HTMLElement;
        const avatarOverlay = document.getElementById("avatar-overlay") as HTMLElement;

        avatarBtn?.addEventListener("click", () => avatarInput?.click());

        avatarInput?.addEventListener("change", () => {
          const file = avatarInput.files?.[0];
          if (!file) return;
          const url = URL.createObjectURL(file);
          avatarPreview.src = url;
          avatarPreview.classList.remove("hidden");
          avatarPlaceholder.classList.add("hidden");
          avatarOverlay.classList.remove("hidden");
          avatarOverlay.classList.add("flex");
        });
      }}
    />
  </div>
);
