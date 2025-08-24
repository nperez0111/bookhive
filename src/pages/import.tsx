import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

export const LibraryImport: FC = () => {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Dynamic table mount; hidden until import starts */}
      <div id="import-table" className="hidden" />

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-6 text-xl font-semibold">Import your library</h2>

        {/* Service Selection */}
        <div className="mb-6">
          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center">
              <input
                type="radio"
                name="import-service"
                value="goodreads"
                className="sr-only"
                defaultChecked
              />
              <div
                id="goodreads-option"
                className="flex items-center rounded-lg border-2 border-yellow-500 bg-yellow-50 px-4 py-3 transition-colors hover:border-yellow-300 dark:border-yellow-500 dark:bg-yellow-900/20 dark:hover:border-yellow-500"
              >
                <span className="font-medium">From Goodreads</span>
              </div>
            </label>
            <label className="flex cursor-pointer items-center">
              <input
                type="radio"
                name="import-service"
                value="storygraph"
                className="sr-only"
              />
              <div
                id="storygraph-option"
                className="flex items-center rounded-lg border-2 border-gray-200 px-4 py-3 transition-colors hover:border-yellow-300 dark:border-zinc-600 dark:hover:border-yellow-500"
              >
                <span className="font-medium">From StoryGraph</span>
              </div>
            </label>
          </div>
        </div>

        {/* Dynamic Instructions */}
        <div id="goodreads-instructions" className="mb-6">
          <p className="text-gray-600 dark:text-gray-300">
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
        </div>

        <div id="storygraph-instructions" className="mb-6 hidden">
          <p className="text-gray-600 dark:text-gray-300">
            To import your StoryGraph library, go to your{" "}
            <a
              href="https://app.thestorygraph.com/user-export"
              className="font-medium text-yellow-600 hover:text-yellow-700"
              target="_blank"
            >
              User Export
            </a>{" "}
            page on StoryGraph and export your library as a CSV file, then
            upload it below.
          </p>
        </div>

        {/* Inline Progress Section (hidden until import starts) */}
        <div id="import-progress" className="mb-6 hidden">
          <div className="rounded-lg border border-gray-200 bg-yellow-50 p-6 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xl font-semibold">Import Progress</span>
              <div id="refresh-button" className="flex justify-end"></div>
            </div>
            <div className="mt-4 space-y-4">
              <div className="flex items-baseline justify-between">
                <span id="progress-text" className="text-lg font-semibold">
                  Processing...
                </span>
                <span
                  id="progress-count"
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  0/0
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-100 dark:bg-zinc-700">
                <div
                  id="progress-bar"
                  className="h-3 rounded-full bg-yellow-500 transition-all duration-300"
                  style="width: 0%"
                ></div>
              </div>
              <div
                id="stage-message"
                className="text-base text-gray-700 dark:text-gray-300"
              ></div>
              <div
                id="current-book"
                className="truncate text-base text-gray-700 dark:text-gray-300"
              ></div>
              <div
                id="failed-books"
                className="max-h-40 overflow-y-auto text-sm text-red-600 dark:text-red-400"
              ></div>
            </div>
          </div>
        </div>

        <label
          id="import-controls"
          className="inline-flex cursor-pointer items-center rounded-lg bg-yellow-100 px-4 py-2 text-yellow-800 transition-colors duration-200 hover:bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-100 dark:hover:bg-yellow-800"
          role="button"
          tabIndex={0}
        >
          <span id="import-label" className="text-sm font-medium">
            Choose CSV File
          </span>
          <span
            id="importing-label"
            className="hidden items-center text-sm font-medium"
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
              // dispatch helper to client table app
              function dispatchImportEvent(detail: any) {
                window.dispatchEvent(
                  new CustomEvent("bookhive:import-event", { detail }),
                );
                // reveal table, progress and hide controls on first meaningful event
                const table = document.getElementById("import-table");
                const controls = document.getElementById("import-controls");
                const progress = document.getElementById("import-progress");
                if (table && table.classList.contains("hidden")) {
                  table.classList.remove("hidden");
                  controls?.classList.add("hidden");
                  progress?.classList.remove("hidden");
                }
              }

              // Handle service selection toggle
              const radioButtons = document.querySelectorAll(
                'input[name="import-service"]',
              ) as NodeListOf<HTMLInputElement>;
              const goodreadsInstructions = document.getElementById(
                "goodreads-instructions",
              );
              const storygraphInstructions = document.getElementById(
                "storygraph-instructions",
              );

              function updateSelection() {
                const selectedService = document.querySelector(
                  'input[name="import-service"]:checked',
                ) as HTMLInputElement;

                const goodreadsOption =
                  document.getElementById("goodreads-option");
                const storygraphOption =
                  document.getElementById("storygraph-option");

                if (selectedService?.value === "storygraph") {
                  // StoryGraph selected
                  goodreadsInstructions?.classList.add("hidden");
                  storygraphInstructions?.classList.remove("hidden");

                  // Update styling
                  if (goodreadsOption) {
                    goodreadsOption.className =
                      "flex items-center rounded-lg border-2 border-gray-200 px-4 py-3 transition-colors hover:border-yellow-300 dark:border-zinc-600 dark:hover:border-yellow-500";
                  }
                  if (storygraphOption) {
                    storygraphOption.className =
                      "flex items-center rounded-lg border-2 border-yellow-500 bg-yellow-50 px-4 py-3 transition-colors hover:border-yellow-300 dark:border-yellow-500 dark:bg-yellow-900/20 dark:hover:border-yellow-500";
                  }
                } else {
                  // Goodreads selected
                  goodreadsInstructions?.classList.remove("hidden");
                  storygraphInstructions?.classList.add("hidden");

                  // Update styling
                  if (storygraphOption) {
                    storygraphOption.className =
                      "flex items-center rounded-lg border-2 border-gray-200 px-4 py-3 transition-colors hover:border-yellow-300 dark:border-zinc-600 dark:hover:border-yellow-500";
                  }
                  if (goodreadsOption) {
                    goodreadsOption.className =
                      "flex items-center rounded-lg border-2 border-yellow-500 bg-yellow-50 px-4 py-3 transition-colors hover:border-yellow-300 dark:border-yellow-500 dark:bg-yellow-900/20 dark:hover:border-yellow-500";
                  }
                }
              }

              // Add event listeners to radio buttons
              radioButtons.forEach((radio) => {
                radio.addEventListener("change", updateSelection);
              });

              // Set initial state on page load
              updateSelection();

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

                // Clear any cached results for a fresh session
                try {
                  localStorage.removeItem("bookhive_import_results");
                } catch {}

                // Get selected service
                const selectedService = document.querySelector(
                  'input[name="import-service"]:checked',
                ) as HTMLInputElement;
                const endpoint =
                  selectedService?.value === "storygraph"
                    ? "/import/storygraph"
                    : "/import/goodreads";

                const form = new FormData();
                form.append("export", files[0]);
                const importLabel = document.getElementById("import-label");
                const importingLabel =
                  document.getElementById("importing-label");
                const controls = document.getElementById("import-controls");
                const progress = document.getElementById("import-progress");
                if (!importingLabel || !importLabel) {
                  throw new Error("Import label not found");
                }
                importLabel.classList.add("hidden");
                importingLabel.classList.remove("hidden");
                // Immediately show inline progress and hide controls
                controls?.classList.add("hidden");
                progress?.classList.remove("hidden");
                const response = await fetch(endpoint, {
                  method: "POST",
                  body: form,
                });
                if (!response.ok || !response.body) {
                  throw new Error("Failed to import books");
                }

                // Get UI elements
                const progressBar = document.getElementById("progress-bar");
                const progressText = document.getElementById("progress-text");
                const progressCount = document.getElementById("progress-count");
                const currentBook = document.getElementById("current-book");
                // For inline list of failures if needed later
                // const failedBooks = document.getElementById("failed-books");
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
                        // Update popup progress UI
                        if (
                          progressBar &&
                          progressText &&
                          progressCount &&
                          currentBook &&
                          stageMessage
                        ) {
                          switch (event.event) {
                            case "import-start": {
                              progressText.textContent = "Starting import...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressBar.style.width = "0%";
                              break;
                            }
                            case "book-load": {
                              progressText.textContent = "Processing books...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent = `${event.stageProgress.current} books processed`;
                              currentBook.textContent = `Current: ${event.title} by ${event.author}`;
                              break;
                            }
                            case "upload-start": {
                              progressText.textContent = "Uploading books...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent =
                                "0/" + event.stageProgress.total;
                              progressBar.style.width = "0%";
                              break;
                            }
                            case "book-upload": {
                              const progress =
                                (event.processed / event.total) * 100;
                              progressBar.style.width = `${progress}%`;
                              progressText.textContent = "Uploading books...";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent = `${event.stageProgress.current}/${event.stageProgress.total}`;
                              currentBook.textContent = `Current: ${event.title} by ${event.author}`;
                              break;
                            }
                            case "import-complete": {
                              progressBar.style.width = "100%";
                              progressText.textContent = "Import complete!";
                              stageMessage.textContent =
                                event.stageProgress.message;
                              progressCount.textContent = `${event.stageProgress.current}/${event.stageProgress.total}`;
                              currentBook.textContent = "";
                              break;
                            }
                          }
                        }

                        // Dispatch a normalized event for the client ImportTableApp
                        if (
                          event.event === "book-upload" &&
                          event.title &&
                          event.author
                        ) {
                          const book = {
                            hiveId: event.hiveId || event.book?.hiveId,
                            title: event.title || event.book?.title,
                            authors: event.author || event.book?.authors,
                            coverImage:
                              event.coverImage || event.book?.coverImage,
                            status: event.status || event.book?.status,
                            finishedAt:
                              event.finishedAt || event.book?.finishedAt,
                            stars: event.stars ?? event.book?.stars,
                            review: event.review ?? event.book?.review,
                            alreadyExists:
                              event.alreadyExists ?? event.book?.alreadyExists,
                          };
                          dispatchImportEvent({
                            event: "book-upload",
                            processed: event.processed,
                            total: event.total,
                            uploaded: event.uploaded,
                            stage: event.stage,
                            stageProgress: event.stageProgress,
                            book,
                          });
                        } else if (
                          event.event === "import-start" ||
                          event.event === "upload-start"
                        ) {
                          dispatchImportEvent(event);
                        } else if (event.event === "import-complete") {
                          dispatchImportEvent(event);
                          if (event.failedBooks?.length) {
                            // Emit individual failure rows at completion to avoid duplicates
                            for (let i = 0; i < event.failedBooks.length; i++) {
                              const fb = event.failedBooks[i];
                              const details =
                                event.failedBookDetails?.[i] || {};
                              dispatchImportEvent({
                                event: "book-failed",
                                failedBook: { ...fb, ...details },
                              });
                            }
                          }
                        }
                      } catch (e) {
                        console.error("Failed to parse SSE message:", e);
                      }
                    }
                  }
                } catch (e) {
                  console.error("Stream reading failed:", e);
                  if (progressText) progressText.textContent = "Import failed";
                  if (stageMessage)
                    stageMessage.textContent =
                      "An error occurred during import. Please try again.";
                } finally {
                  importLabel.classList.remove("hidden");
                  importingLabel.classList.add("hidden");
                  // Add reset/import-more button after import completes
                  const container = document.getElementById("refresh-button");
                  if (container) {
                    container.innerHTML = "";
                    const reset = document.createElement("button");
                    reset.textContent = "Import more";
                    reset.className =
                      "px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors duration-200 text-sm font-medium";
                    reset.addEventListener("click", () => {
                      try {
                        localStorage.removeItem("bookhive_import_results");
                      } catch {}
                      window.location.reload();
                    });
                    container.appendChild(reset);
                  }
                }
              });
            }}
          ></Script>
        </label>
      </div>
    </div>
  );
};
