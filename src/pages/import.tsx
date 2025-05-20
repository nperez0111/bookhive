import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

export const GoodreadsImport: FC = () => {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-4 text-xl font-semibold">Import from Goodreads</h2>

        <p className="mb-6 text-gray-600 dark:text-gray-300">
          To import your Goodreads library, first{" "}
          <a
            href="https://www.goodreads.com/review/import"
            className="font-medium text-yellow-600 hover:text-yellow-700"
            target="_blank"
          >
            export your library from Goodreads
          </a>
          , then upload the CSV file below.
        </p>

        <label
          className="inline-flex cursor-pointer items-center rounded-lg bg-yellow-100 px-4 py-2 text-yellow-800 transition-colors duration-200 hover:bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-100 dark:hover:bg-yellow-800"
          role="button"
          tabIndex={0}
        >
          <span id="import-label" className="text-sm font-medium">
            Choose CSV File
          </span>
          <span
            id="importing-label"
            className="flex hidden items-center text-sm font-medium"
          >
            Importing...
            <svg className="ml-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
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
            className="hidden"
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
                  "fixed bottom-4 right-4 md:right-8 bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-lg border border-gray-200 dark:border-zinc-700 z-50 w-[calc(100%-2rem)] md:w-[448px]";
                progressDiv.innerHTML = `
                  <div class="flex flex-col gap-4">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold text-lg">Import Progress</span>
                      <button class="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors" id="close-progress">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                      </button>
                    </div>
                    <div class="space-y-3">
                      <div class="flex justify-between text-sm">
                        <span id="progress-text" class="font-medium">Processing...</span>
                        <span id="progress-count" class="text-gray-600 dark:text-gray-400">0/0</span>
                      </div>
                      <div class="w-full bg-gray-100 dark:bg-zinc-700 rounded-full h-2">
                        <div id="progress-bar" class="bg-yellow-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                      </div>
                    </div>
                    <div id="stage-message" class="text-sm text-gray-600 dark:text-gray-400"></div>
                    <div id="current-book" class="text-sm text-gray-600 dark:text-gray-400 truncate"></div>
                    <div id="failed-books" class="text-sm text-red-600 dark:text-red-400 max-h-32 overflow-y-auto"></div>
                    <div id="refresh-button" class="flex justify-end"></div>
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
                const progressText = document.getElementById("progress-text");
                const progressCount = document.getElementById("progress-count");
                const currentBook = document.getElementById("current-book");
                const failedBooks = document.getElementById("failed-books");
                const stageMessage = document.getElementById("stage-message");

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
                          failedBooks &&
                          stageMessage
                        ) {
                          // Handle different event types
                          switch (event.event) {
                            case "import-start":
                              progressText.textContent = "Starting import...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressBar.style.width = "0%";
                              break;

                            case "book-load":
                              progressText.textContent = "Processing books...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent = `${event.stageProgress.current} books processed`;
                              currentBook.textContent = `Current: ${event.title} by ${event.author}`;
                              break;

                            case "upload-start":
                              progressText.textContent = "Uploading books...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent =
                                "0/" + event.stageProgress.total;
                              progressBar.style.width = "0%";
                              break;

                            case "book-upload":
                              const progress =
                                (event.processed / event.total) * 100;
                              progressBar.style.width = `${progress}%`;
                              progressText.textContent = "Uploading books...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent = `${event.stageProgress.current}/${event.stageProgress.total}`;
                              currentBook.textContent = `Current: ${event.title} by ${event.author}`;
                              break;

                            case "import-complete":
                              progressBar.style.width = "100%";
                              progressText.textContent = "Import complete!";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent = `${event.stageProgress.current}/${event.stageProgress.total}`;
                              currentBook.textContent = "";
                              break;
                          }

                          if (event.failedBooks?.length > 0) {
                            failedBooks.innerHTML = `
                              <p class="font-medium mb-2">Failed to import ${event.failedBooks.length} books:</p>
                              ${event.failedBooks
                                .map(
                                  (b: { title: string; author: string }) =>
                                    `<div class="pl-3 border-l-2 border-red-400 mb-2">
                                  ${b.title} by ${b.author}
                                </div>`,
                                )
                                .join("")}
                            `;
                          }
                        }
                      } catch (e) {
                        console.error("Failed to parse SSE message:", e);
                      }
                    }
                  }
                } catch (e) {
                  console.error("Stream reading failed:", e);
                  progressText!.textContent = "Import failed";
                  stageMessage!.textContent =
                    "An error occurred during import. Please try again.";
                } finally {
                  importLabel.classList.remove("hidden");
                  importingLabel.classList.add("hidden");
                  // Add refresh button after import completes
                  const refreshButton = document.createElement("a");
                  refreshButton.href = "/profile";
                  refreshButton.textContent = "See your imported books";
                  refreshButton.className =
                    "px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors duration-200 text-sm font-medium";
                  document
                    .getElementById("refresh-button")
                    ?.appendChild(refreshButton);
                }
              });
            }}
          ></Script>
        </label>
      </div>
    </div>
  );
};
