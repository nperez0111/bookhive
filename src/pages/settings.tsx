import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

export const SettingsPage: FC<{ handle: string }> = ({ handle }) => {
  return (
    <div class="mx-auto max-w-2xl space-y-8 px-4 py-8 lg:px-8">
      <h1 class="text-2xl font-bold text-foreground">Account Settings</h1>

      <div class="card border-red-300 dark:border-red-800">
        <div class="card-body">
          <h2 class="text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
          <p class="text-muted-foreground mt-1 text-sm">
            Permanently delete your BookHive account data. This will remove all your books, reviews,
            buzzes, and lists from both your PDS and the BookHive database. This action cannot be
            undone.
          </p>

          <button
            type="button"
            id="delete-account-btn"
            class="mt-4 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-[background-color,scale] duration-150 ease-out hover:bg-red-700 active:scale-[0.96]"
          >
            Delete my account
          </button>

          <div id="delete-confirm-section" class="mt-4 hidden">
            <form method="post" action="/settings/delete-account" id="delete-account-form">
              <label class="text-sm font-medium text-foreground" for="confirm-handle">
                Type <span class="font-bold">{handle}</span> to confirm
              </label>
              <input
                id="confirm-handle"
                name="confirmHandle"
                type="text"
                autocomplete="off"
                class="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder={handle}
                data-expected={handle}
              />
              <div class="mt-3 flex gap-2">
                <button
                  type="submit"
                  id="confirm-delete-btn"
                  disabled
                  class="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-[background-color,scale,opacity] duration-150 ease-out hover:bg-red-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Permanently delete my data
                </button>
                <button type="button" id="cancel-delete-btn" class="btn btn-ghost min-h-[40px]">
                  Cancel
                </button>
              </div>
            </form>
          </div>

          <Script
            script={(document) => {
              const showBtn = document.getElementById("delete-account-btn")!;
              const section = document.getElementById("delete-confirm-section")!;
              const input = document.getElementById("confirm-handle") as HTMLInputElement;
              const submitBtn = document.getElementById("confirm-delete-btn") as HTMLButtonElement;
              const cancelBtn = document.getElementById("cancel-delete-btn")!;
              const expected = input.getAttribute("data-expected")!;

              showBtn.addEventListener("click", () => {
                showBtn.classList.add("hidden");
                section.classList.remove("hidden");
                input.focus();
              });

              cancelBtn.addEventListener("click", () => {
                section.classList.add("hidden");
                showBtn.classList.remove("hidden");
                input.value = "";
                submitBtn.disabled = true;
              });

              input.addEventListener("input", () => {
                submitBtn.disabled = input.value !== expected;
              });

              document.getElementById("delete-account-form")!.addEventListener("submit", () => {
                submitBtn.disabled = true;
                submitBtn.textContent = "Deleting...";
              });
            }}
          />
        </div>
      </div>
    </div>
  );
};
