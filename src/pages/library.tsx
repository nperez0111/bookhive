import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

/**
 * E-reader connection details. Rendered inline on an empty library (it's the
 * first thing a new user needs) and inside a dialog once they have books.
 */
const EReaderCredentials: FC<{ handle: string }> = ({ handle }) => (
  <div class="space-y-3">
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
        <code id="opds-url" class="rounded-md border border-border bg-muted px-3 py-1.5 text-sm">
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
      <div class="mt-1 flex flex-wrap items-center gap-2">
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
        The same username and password work for both KOSync and OPDS. Reset if you revealed the
        password by accident -- this invalidates the old one, so you'll need to re-enter the new
        password on each device.
      </p>
    </div>

    <details class="mt-2">
      <summary class="text-muted-foreground cursor-pointer text-sm">Setup instructions</summary>
      <ol class="text-muted-foreground mt-2 list-inside list-decimal space-y-1 text-sm">
        <li>Open a document on your KOReader device</li>
        <li>Go to Settings &rarr; Progress Sync &rarr; Custom sync server</li>
        <li>Enter the KOSync Server URL above</li>
        <li>Select "Login" and enter your username and password</li>
        <li>Test with "Push progress from this device now"</li>
        <li>
          For OPDS access, add the OPDS Catalog URL to your e-reader's OPDS browser with the same
          username and password
        </li>
      </ol>
    </details>
  </div>
);

/**
 * Drag-and-drop upload form. Posts as a normal multipart form and redirects
 * back to /library, so it works identically inline and inside a dialog.
 */
const UploadZone: FC = () => (
  <form method="post" action="/library/upload" enctype="multipart/form-data">
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
        Drop a file here or click to choose
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
);

/** Wires reveal/reset/copy for the credentials block and auto-submit for uploads. */
const LibraryScripts: FC = () => (
  <Script
    script={(document) => {
      const revealBtn = document.getElementById("sync-reveal-btn");
      const copyPwBtn = document.getElementById("sync-copy-pw-btn");
      const pwEl = document.getElementById("sync-password");

      if (revealBtn && pwEl) {
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
      }

      const urlEl = document.getElementById("sync-server-url");
      if (urlEl) urlEl.textContent = window.location.origin + "/kosync";

      const opdsEl = document.getElementById("opds-url");
      if (opdsEl) opdsEl.textContent = window.location.origin + "/opds";

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

      // Upload: submit as soon as a file is chosen or dropped.
      const zone = document.getElementById("upload-zone");
      const fileInput = document.getElementById("upload-file") as HTMLInputElement | null;
      const label = document.getElementById("upload-label");
      const submitBtn = document.getElementById("upload-submit");
      if (!zone || !fileInput || !label || !submitBtn) return;

      const startUpload = (name: string) => {
        label.textContent = name;
        submitBtn.classList.remove("hidden");
        submitBtn.textContent = "Uploading...";
        const form = submitBtn.closest("form") as HTMLFormElement | null;
        form?.submit();
        (submitBtn as HTMLButtonElement).disabled = true;
      };

      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) startUpload(file.name);
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
          startUpload(droppedFile.name);
        }
      });
    }}
  />
);

/** Native dialog shell, matching the pattern used on the book and comments pages. */
const LibraryDialog: FC<{
  id: string;
  title: string;
  description?: string;
  children?: unknown;
}> = ({ id, title, description, children }) => (
  // `m-auto` restores the centering a modal <dialog> gets from the UA
  // stylesheet — Tailwind's preflight resets margin to 0 on every element.
  <dialog
    id={id}
    class="m-auto max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl bg-card p-6 text-card-foreground shadow-xl backdrop:bg-black/50"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p class="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground -mt-1 shrink-0 rounded-full px-2 text-xl leading-none"
        aria-label="Close"
        onclick="this.closest('dialog').close()"
      >
        &times;
      </button>
    </div>
    <div class="mt-4">{children}</div>
  </dialog>
);

export const LibraryPage: FC<{
  handle: string;
  bookCount: number;
  syncDocCount: number;
}> = ({ handle, bookCount, syncDocCount }) => {
  // Nothing uploaded and nothing synced: there's no library to manage yet, so
  // explain the feature and put setup right on the page instead of behind
  // buttons the user has no reason to press.
  const isEmpty = bookCount === 0 && syncDocCount === 0;

  if (isEmpty) {
    return (
      <div class="mx-auto max-w-2xl space-y-8 px-4 py-8 lg:px-8">
        <div>
          <h1 class="text-2xl font-bold text-foreground">Personal Library</h1>
          <p class="text-muted-foreground mt-2 text-sm">
            Your private ebook shelf. Upload your files here and BookHive serves them to your
            e-reader as an OPDS catalog -- browse and download them straight from KOReader, and your
            reading progress syncs back to your BookHive books automatically. Files stay private to
            you; nothing is published to your PDS.
          </p>
        </div>

        <div class="card">
          <div class="card-body">
            <h2 class="text-lg font-semibold text-foreground">1. Connect your e-reader</h2>
            <p class="text-muted-foreground mt-1 mb-4 text-sm">
              Point KOReader at these URLs to sync progress and browse your catalog.
            </p>
            <EReaderCredentials handle={handle} />
          </div>
        </div>

        <div class="card">
          <div class="card-body">
            <h2 class="text-lg font-semibold text-foreground">2. Add your first book</h2>
            <p class="text-muted-foreground mt-1 mb-4 text-sm">
              Supported formats: EPUB, MOBI, AZW3, FB2, CBZ.
            </p>
            <UploadZone />
          </div>
        </div>

        <LibraryScripts />
      </div>
    );
  }

  return (
    <div class="mx-auto max-w-6xl px-4 py-8 lg:px-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold text-foreground">Personal Library</h1>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-secondary min-h-[40px]"
            onclick="document.getElementById('ereader-dialog').showModal()"
          >
            Connect e-reader
          </button>
          <button
            type="button"
            class="btn btn-primary min-h-[40px]"
            onclick="document.getElementById('upload-dialog').showModal()"
          >
            Upload books
          </button>
        </div>
      </div>

      <LibraryDialog
        id="ereader-dialog"
        title="Connect your e-reader"
        description="Sync reading progress and browse your library from KOReader or any OPDS-compatible app."
      >
        <EReaderCredentials handle={handle} />
      </LibraryDialog>

      <LibraryDialog
        id="upload-dialog"
        title="Upload books"
        description="Add ebooks to your personal library. Supported formats: EPUB, MOBI, AZW3, FB2, CBZ."
      >
        <UploadZone />
      </LibraryDialog>

      <div id="mount-library-manager" class="mt-6" data-handle={handle} />

      <LibraryScripts />
    </div>
  );
};
