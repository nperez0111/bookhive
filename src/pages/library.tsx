import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

export const LibraryPage: FC<{
  handle: string;
}> = ({ handle }) => {
  return (
    <div class="mx-auto max-w-4xl space-y-8 px-4 py-8 lg:px-8">
      <h1 class="text-2xl font-bold text-foreground">Personal Library</h1>

      {/* Section A: E-Reader Connection */}
      <div class="card">
        <div class="card-body">
          <h2 class="text-lg font-semibold text-foreground">Connect Your E-Reader</h2>
          <p class="text-muted-foreground mt-1 text-sm">
            Sync reading progress and access your library from KOReader or any OPDS-compatible
            e-reader app.
          </p>

          <div class="mt-4 space-y-3">
            <div>
              <label class="text-sm font-medium text-foreground">KOSync Server URL</label>
              <div class="mt-1 flex items-center gap-2">
                <code
                  id="sync-server-url"
                  class="rounded-md border border-border bg-muted px-3 py-1.5 text-sm"
                >
                  /kosync
                </code>
                <button type="button" class="btn btn-ghost btn-sm" data-copy="sync-server-url">
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-foreground">OPDS Catalog URL</label>
              <div class="mt-1 flex items-center gap-2">
                <code
                  id="opds-url"
                  class="rounded-md border border-border bg-muted px-3 py-1.5 text-sm"
                >
                  /opds
                </code>
                <button type="button" class="btn btn-ghost btn-sm" data-copy="opds-url">
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-foreground">Username</label>
              <div class="mt-1 flex items-center gap-2">
                <code
                  id="sync-username"
                  class="rounded-md border border-border bg-muted px-3 py-1.5 text-sm"
                >
                  {handle}
                </code>
                <button type="button" class="btn btn-ghost btn-sm" data-copy="sync-username">
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-foreground">Password</label>
              <div class="mt-1 flex items-center gap-2">
                <code
                  id="sync-password"
                  class="rounded-md border border-border bg-muted px-3 py-1.5 text-sm"
                >
                  ••••••••••••••••
                </code>
                <button type="button" id="sync-reveal-btn" class="btn btn-ghost btn-sm">
                  Show
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm hidden"
                  id="sync-copy-pw-btn"
                  data-copy="sync-password"
                >
                  Copy
                </button>
                <button type="button" id="sync-reset-btn" class="btn btn-ghost btn-sm">
                  Reset
                </button>
              </div>
              <p class="text-muted-foreground mt-1 text-xs">
                Reset if you revealed the password by accident. This invalidates the old one --
                you'll need to re-enter the new password on each device.
              </p>
            </div>

            <details class="mt-2">
              <summary class="text-muted-foreground cursor-pointer text-sm">
                Setup instructions
              </summary>
              <ol class="text-muted-foreground mt-2 list-inside list-decimal space-y-1 text-sm">
                <li>Open a document on your KOReader device</li>
                <li>Go to Settings &rarr; Progress Sync &rarr; Custom sync server</li>
                <li>Enter the KOSync Server URL above</li>
                <li>Select "Login" and enter your username and password</li>
                <li>Test with "Push progress from this device now"</li>
                <li>
                  For OPDS access, add the OPDS Catalog URL to your e-reader's OPDS browser with the
                  same username and password
                </li>
              </ol>
            </details>
          </div>

          <Script
            script={(document) => {
              const revealBtn = document.getElementById("sync-reveal-btn");
              const copyPwBtn = document.getElementById("sync-copy-pw-btn");
              const pwEl = document.getElementById("sync-password");
              if (!revealBtn || !pwEl) return;

              let revealed = false;
              revealBtn.addEventListener("click", async () => {
                if (revealed) {
                  pwEl.textContent = "••••••••••••••••";
                  revealBtn.textContent = "Show";
                  if (copyPwBtn) copyPwBtn.classList.add("hidden");
                  revealed = false;
                  return;
                }
                try {
                  const res = await fetch("/library/sync/password");
                  const data = (await res.json()) as { password: string };
                  pwEl.textContent = data.password;
                  revealBtn.textContent = "Hide";
                  if (copyPwBtn) copyPwBtn.classList.remove("hidden");
                  revealed = true;
                } catch {
                  // ignore
                }
              });

              const resetBtn = document.getElementById("sync-reset-btn");
              if (resetBtn) {
                resetBtn.addEventListener("click", async () => {
                  if (
                    !window.confirm(
                      "Reset your sync password? The current password will stop working and you'll need to re-enter the new one on every device.",
                    )
                  ) {
                    return;
                  }
                  try {
                    const res = await fetch("/library/sync/rotate", { method: "POST" });
                    const data = (await res.json()) as { password: string };
                    pwEl.textContent = data.password;
                    revealBtn.textContent = "Hide";
                    if (copyPwBtn) copyPwBtn.classList.remove("hidden");
                    revealed = true;
                  } catch {
                    // ignore
                  }
                });
              }

              const urlEl = document.getElementById("sync-server-url");
              if (urlEl) {
                urlEl.textContent = window.location.origin + "/kosync";
              }

              const opdsEl = document.getElementById("opds-url");
              if (opdsEl) {
                opdsEl.textContent = window.location.origin + "/opds";
              }

              document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
                btn.addEventListener("click", () => {
                  const targetId = btn.getAttribute("data-copy");
                  if (!targetId) return;
                  const target = document.getElementById(targetId);
                  if (!target) return;
                  void navigator.clipboard.writeText(target.textContent || "").then(() => {
                    const orig = btn.textContent;
                    btn.textContent = "Copied!";
                    setTimeout(() => {
                      btn.textContent = orig;
                    }, 1500);
                  });
                });
              });
            }}
          />
        </div>
      </div>

      {/* Section B: Upload Books */}
      <div class="card">
        <div class="card-body">
          <h2 class="text-lg font-semibold text-foreground">Upload Books</h2>
          <p class="text-muted-foreground mt-1 text-sm">
            Add ebooks to your personal library. Supported formats: EPUB, MOBI, AZW3, FB2, CBZ.
          </p>

          <form method="post" action="/library/upload" enctype="multipart/form-data" class="mt-4">
            <label
              id="upload-zone"
              class="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-8 transition-[border-color,background-color,scale] duration-150 hover:border-primary/50 hover:bg-muted/50 active:scale-[0.98]"
            >
              <svg
                class="size-8 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
              <span id="upload-label" class="mt-2 text-sm font-medium text-foreground">
                Drop files here or click to choose
              </span>
              <span class="mt-1 text-xs text-muted-foreground">
                EPUB, MOBI, AZW3, FB2, CBZ -- up to 100 MB
              </span>
              <input
                id="upload-file"
                type="file"
                name="file"
                accept=".epub,.mobi,.azw,.azw3,.fb2,.cbz"
                class="hidden"
              />
            </label>
            <button type="submit" id="upload-submit" class="btn btn-primary mt-3 hidden">
              Upload
            </button>
          </form>

          <Script
            script={(document) => {
              const zone = document.getElementById("upload-zone");
              const fileInput = document.getElementById("upload-file") as HTMLInputElement | null;
              const label = document.getElementById("upload-label");
              const submitBtn = document.getElementById("upload-submit");
              if (!zone || !fileInput || !label || !submitBtn) return;

              fileInput.addEventListener("change", () => {
                const file = fileInput.files?.[0];
                if (file) {
                  label.textContent = file.name;
                  (submitBtn as HTMLButtonElement).disabled = true;
                  submitBtn.textContent = "Uploading...";
                  submitBtn.classList.remove("hidden");
                  submitBtn.closest("form")?.submit();
                }
              });

              zone.addEventListener("dragover", (e) => {
                e.preventDefault();
                zone.classList.add("border-primary", "bg-primary/5");
              });

              zone.addEventListener("dragleave", () => {
                zone.classList.remove("border-primary", "bg-primary/5");
              });

              zone.addEventListener("drop", (e) => {
                e.preventDefault();
                zone.classList.remove("border-primary", "bg-primary/5");
                const dt = (e as DragEvent).dataTransfer;
                const droppedFile = dt?.files[0];
                if (dt && droppedFile) {
                  fileInput.files = dt.files;
                  label.textContent = droppedFile.name;
                  (submitBtn as HTMLButtonElement).disabled = true;
                  submitBtn.textContent = "Uploading...";
                  submitBtn.classList.remove("hidden");
                  submitBtn.closest("form")?.submit();
                }
              });

              const form = submitBtn.closest("form");
              if (form) {
                form.addEventListener("submit", () => {
                  (submitBtn as HTMLButtonElement).disabled = true;
                  submitBtn.textContent = "Uploading...";
                });
              }
            }}
          />
        </div>
      </div>

      {/* Section C: Library Books */}
      <div class="card">
        <div class="card-body">
          <h2 class="text-lg font-semibold text-foreground">Your Books</h2>
          <div id="mount-library-manager" />
        </div>
      </div>

      {/* Section D: Synced Documents */}
      <div class="card">
        <div class="card-body">
          <h2 class="text-lg font-semibold text-foreground">Synced Documents</h2>
          <p class="text-muted-foreground mt-1 text-sm">
            Documents synced from your KOReader e-reader. Link them to books in your library to
            track reading progress.
          </p>
          <div
            id="mount-sync-documents"
            data-endpoint="/library/sync/documents"
            data-link-endpoint="/library/sync/link"
          />
        </div>
      </div>
    </div>
  );
};
