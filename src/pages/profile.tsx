import { type FC } from "hono/jsx";
import { type Book } from "../types";
import type { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import { BookList } from "./components/book";
import { formatDistanceToNow } from "date-fns";
import { FallbackCover } from "./components/fallbackCover";
import { Script } from "./utils/script";

export const ProfilePage: FC<{
  handle: string;
  books: Book[];
  isBuzzer: boolean;
  profile: ProfileViewDetailed | null;
  isOwner: boolean;
}> = ({ handle, profile, books, isBuzzer, isOwner }) => {
  return (
    <div class="bg-sand container mx-auto min-h-[calc(100vh-64px)] max-w-7xl p-8 px-3 dark:bg-zinc-900 dark:text-white">
      <div class="mb-12 flex items-start gap-8 px-4">
        {profile?.avatar && (
          <img
            class="size-32 rounded-xl object-cover shadow-lg transition sm:size-40 md:size-56"
            src={`/images/w_500/${profile.avatar}`}
            alt=""
          />
        )}
        <div class="flex flex-col gap-4">
          <h1 class="text-5xl leading-12 font-bold lg:text-6xl lg:tracking-tight">
            {profile?.displayName || handle}
          </h1>
          <p class="text-lg text-slate-600 dark:text-slate-400">
            <a
              href={`https://bsky.app/profile/${handle}`}
              class="inline text-blue-600 hover:underline"
            >
              @{handle} 🦋
            </a>
            {books.length
              ? ` • Joined ${formatDistanceToNow(books.map((book) => book.createdAt).sort()[0], { addSuffix: true })}`
              : null}
          </p>
          {profile?.description && (
            <p class="max-w-2xl leading-relaxed text-slate-600 dark:text-slate-300">
              {profile.description}
            </p>
          )}
        </div>
      </div>

      <div class="flex flex-col gap-10">
        {isOwner && (
          <div class="px-4 lg:px-8">
            To export your Goodreads library,{" "}
            <a
              href="https://www.goodreads.com/review/import"
              class="inline text-blue-800 hover:underline"
              target="_blank"
            >
              export your library
            </a>{" "}
            and then you can import it here:
            <label
              class="ml-3 inline-block cursor-pointer rounded-md bg-yellow-50 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              role="menuitem"
              tabindex={-1}
              id="user-menu-item-2"
            >
              <span id="import-label">Import Goodreads CSV</span>
              <span id="importing-label" class="hidden">
                Importing...
                <svg
                  class="ml-2 inline-block h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                    fill="none"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </span>
              <input
                id="import-file"
                type="file"
                name="export"
                accept=".csv"
                class="hidden"
              />
              <Script
                script={(document) => {
                  const importFile = document.getElementById(
                    "import-file",
                  ) as HTMLInputElement;
                  if (!importFile) {
                    throw new Error("Import file not found");
                  }
                  importFile.addEventListener("change", async () => {
                    const files = importFile.files;
                    if (!files || files.length === 0) {
                      alert("Please select a file to import");
                      return;
                    }
                    const form = new FormData();
                    form.append("export", files[0]);
                    const importLabel = document.getElementById("import-label");
                    const importingLabel =
                      document.getElementById("importing-label");
                    if (!importingLabel || !importLabel) {
                      throw new Error("Import label not found");
                    }
                    importLabel.classList.add("hidden");
                    importingLabel.classList.remove("hidden");
                    const response = await fetch("/import/goodreads", {
                      method: "POST",
                      body: form,
                    });
                    if (!response.ok || !response.body) {
                      throw new Error("Failed to import books");
                    }

                    // Create progress display
                    const progressDiv = document.createElement("div");
                    progressDiv.className =
                      "fixed bottom-4 right-4 md:right-8 bg-white dark:bg-zinc-800 p-4 rounded-lg shadow-lg z-50 w-[calc(100%-2rem)] md:w-[448px]";
                    progressDiv.innerHTML = `
                      <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                          <span class="font-medium text-lg">BookHive Import</span>
                          <button class="text-gray-500 hover:text-gray-700" id="close-progress">×</button>
                        </div>
                        <div class="flex flex-col gap-1">
                          <div class="flex justify-between text-sm">
                            <span id="progress-text">Processing...</span>
                            <span id="progress-count">0/0</span>
                          </div>
                          <div class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-yellow-950">
                            <div id="progress-bar" class="bg-yellow-500 h-2.5 rounded-full" style="width: 0%"></div>
                          </div>
                        </div>
                        <div id="current-book" class="text-sm text-gray-600 dark:text-gray-400 truncate"></div>
                        <div id="failed-books" class="text-sm text-red-600 dark:text-red-400"></div>
                        <div id="refresh-button" ></div>
                      </div>
                    `;
                    document.body.appendChild(progressDiv);

                    // Add close button handler
                    document
                      .getElementById("close-progress")
                      ?.addEventListener("click", () => {
                        progressDiv.remove();
                      });

                    // Get UI elements
                    const progressBar = document.getElementById("progress-bar");
                    const progressText =
                      document.getElementById("progress-text");
                    const progressCount =
                      document.getElementById("progress-count");
                    const currentBook = document.getElementById("current-book");
                    const failedBooks = document.getElementById("failed-books");

                    try {
                      // Read the stream
                      const reader = response.body
                        .pipeThrough(new TextDecoderStream())
                        .getReader();

                      while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        // Each SSE message is prefixed with "data: " and ends with two newlines
                        const messages = value.split("\n\n");
                        for (const message of messages) {
                          if (!message.trim()) continue;

                          // Parse the SSE data
                          const data = message.replace(/^data: /, "");
                          try {
                            const event = JSON.parse(data);

                            if (
                              progressBar &&
                              progressText &&
                              progressCount &&
                              currentBook &&
                              failedBooks
                            ) {
                              const progress =
                                (event.processed / event.total) * 100;
                              progressBar.style.width = `${progress}%`;
                              progressText.textContent = `Processing books...`;
                              progressCount.textContent = `${event.processed}/${event.total}`;
                              currentBook.textContent = `Current: ${event.title} by ${event.author}`;

                              if (event.failedBooks.length > 0) {
                                failedBooks.innerHTML = `Failed to import:<br>${event.failedBooks.map((b: { title: string; author: string }) => `- ${b.title} by ${b.author}`).join("<br>")}`;
                              }
                            }
                          } catch (e) {
                            console.error("Failed to parse SSE message:", e);
                          }
                        }
                      }
                    } catch (e) {
                      console.error("Stream reading failed:", e);
                    } finally {
                      progressText!.textContent = "Import complete";
                      importLabel.classList.remove("hidden");
                      importingLabel.classList.add("hidden");
                      // Add refresh button after import completes
                      const refreshButton = document.createElement("button");
                      refreshButton.textContent = "Refresh to see new books";
                      refreshButton.className =
                        "mt-4 rounded-lg bg-yellow-600 px-4 py-2 text-white hover:bg-yellow-700 cursor-pointer";
                      refreshButton.onclick = () => window.location.reload();
                      document
                        .getElementById("refresh-button")
                        ?.appendChild(refreshButton);
                    }
                  });
                }}
              ></Script>
            </label>
          </div>
        )}
        {isBuzzer ? (
          <>
            <section class="mt-8 flex flex-col gap-2 px-4 lg:px-8">
              <div class="mb-6">
                <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
                  Library
                </h2>
              </div>
              <BookList books={books} />
            </section>
            {books.some((book) => book.review) && (
              <section class="mt-16 flex flex-col gap-2 px-4 lg:px-8">
                <div class="mb-6">
                  <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
                    Reviews
                  </h2>
                </div>
                {books
                  .filter((book) => book.review)
                  .map((book) => {
                    return (
                      <div class="group mb-2 cursor-pointer rounded-lg border border-slate-200 bg-yellow-50 p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-zinc-800">
                        <a href={`/books/${book.hiveId}`} class="flex gap-4">
                          {book.cover || book.thumbnail ? (
                            <img
                              src={`${book.cover || book.thumbnail || ""}`}
                              // src={`/images/w_300/${book.cover || book.thumbnail || ""}`}
                              alt=""
                              class="h-36 w-24 rounded-lg object-cover shadow-sm"
                            />
                          ) : (
                            <FallbackCover className="h-36 w-24" />
                          )}
                          <span class="flex flex-col gap-1">
                            <span class="text-lg font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400">
                              {book.title}
                            </span>
                            <span class="text-sm text-slate-600 dark:text-slate-400">
                              by {book.authors.split("\t").join(", ")}
                              {book.stars ? (
                                <span class="text-md mx-1 text-slate-800 dark:text-slate-200">
                                  ({book.stars / 2} ⭐)
                                </span>
                              ) : null}
                            </span>
                            <p class="py-2">{book.review}</p>
                          </span>
                        </a>
                      </div>
                    );
                  })}
              </section>
            )}
          </>
        ) : (
          <div class="text-center">😔 This user has no books on bookhive</div>
        )}
      </div>
    </div>
  );
};
