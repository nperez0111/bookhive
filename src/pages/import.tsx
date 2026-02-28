import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

const SHARE_TEXT =
  "I just imported my reading list to BookHive! 📚 https://bookhive.social";

export const LibraryImport: FC = () => {
  return (
    <div class="space-y-6">
      {/* Dynamic table mount; hidden until import starts */}
      <div id="import-table" class="hidden" />

      <div class="card">
        <div class="card-body">
          <h2 class="card-title mb-6">Import your library</h2>

          {/* Service Selection: radio group with visual cards */}
          <div class="mb-6">
            <p class="text-muted-foreground mb-3 text-sm">
              Choose where to import from
            </p>
            <div class="flex flex-wrap gap-4">
              <label class="flex cursor-pointer">
                <input
                  type="radio"
                  name="import-service"
                  value="goodreads"
                  class="peer sr-only"
                  defaultChecked
                />
                <div class="card flex flex-1 items-center border-2 px-4 py-3 transition-colors peer-checked:border-primary peer-checked:bg-primary/5 hover:border-border min-w-[140px]">
                  <span class="font-medium text-foreground">
                    From Goodreads
                  </span>
                </div>
              </label>
              <label class="flex cursor-pointer">
                <input
                  type="radio"
                  name="import-service"
                  value="storygraph"
                  class="peer sr-only"
                />
                <div class="card flex flex-1 items-center border-2 px-4 py-3 transition-colors peer-checked:border-primary peer-checked:bg-primary/5 hover:border-border min-w-[140px]">
                  <span class="font-medium text-foreground">
                    From StoryGraph
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Dynamic Instructions */}
          <div id="goodreads-instructions" class="mb-6">
            <p class="text-muted-foreground text-sm">
              To import your Goodreads library, first{" "}
              <a
                href="https://www.goodreads.com/review/import"
                class="font-medium text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                export your library from Goodreads
              </a>
              , then upload the CSV file below.
            </p>
          </div>

          <div id="storygraph-instructions" class="mb-6 hidden">
            <p class="text-muted-foreground text-sm">
              To import your StoryGraph library, go to your{" "}
              <a
                href="https://app.thestorygraph.com/user-export"
                class="font-medium text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                User Export
              </a>{" "}
              page and export your library as CSV, then upload it below.
            </p>
          </div>

          {/* Inline Progress Section (hidden until import starts) */}
          <div id="import-progress" class="mb-6 hidden">
            <div class="card border-primary/30">
              <div class="card-body">
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span class="font-semibold text-foreground">
                    Import Progress
                  </span>
                  <div id="refresh-button" class="flex justify-end" />
                </div>
                <div class="mt-4 space-y-4">
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <span
                      id="progress-text"
                      class="font-semibold text-foreground"
                    >
                      Processing...
                    </span>
                    <span
                      id="progress-count"
                      class="text-sm text-muted-foreground"
                    >
                      0/0
                    </span>
                  </div>
                  <div class="progress">
                    <div
                      id="progress-bar"
                      class="progress-bar transition-all duration-300"
                      style="width: 0%"
                    />
                  </div>
                  <div
                    id="stage-message"
                    class="alert text-sm"
                    role="status"
                  />
                  <div
                    id="current-book"
                    class="truncate text-sm text-muted-foreground"
                  />
                  <div
                    id="failed-books"
                    class="alert alert-destructive max-h-40 overflow-y-auto text-sm"
                    role="alert"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* File upload: drag-drop zone visual */}
          <label
            id="import-controls"
            class="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-8 transition-colors hover:border-primary/50 hover:bg-muted/50"
            role="button"
            tabindex={0}
          >
            <span id="import-label" class="text-sm font-medium text-foreground">
              Drop CSV here or click to choose
            </span>
            <span
              id="importing-label"
              class="hidden items-center gap-2 text-sm font-medium text-foreground"
            >
              Importing...
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24">
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
                const shareText = encodeURIComponent(SHARE_TEXT);

                function dispatchImportEvent(detail: any) {
                  window.dispatchEvent(
                    new CustomEvent("bookhive:import-event", { detail }),
                  );
                  const table = document.getElementById("import-table");
                  const controls = document.getElementById("import-controls");
                  const progress = document.getElementById("import-progress");
                  if (table?.classList.contains("hidden")) {
                    table.classList.remove("hidden");
                    controls?.classList.add("hidden");
                    progress?.classList.remove("hidden");
                  }
                }

                const radioButtons = document.querySelectorAll(
                  'input[name="import-service"]',
                ) as NodeListOf<HTMLInputElement>;
                const goodreadsInstructions =
                  document.getElementById("goodreads-instructions");
                const storygraphInstructions = document.getElementById(
                  "storygraph-instructions",
                );

                function updateSelection() {
                  const selectedService = document.querySelector(
                    'input[name="import-service"]:checked',
                  ) as HTMLInputElement;
                  if (selectedService?.value === "storygraph") {
                    goodreadsInstructions?.classList.add("hidden");
                    storygraphInstructions?.classList.remove("hidden");
                  } else {
                    goodreadsInstructions?.classList.remove("hidden");
                    storygraphInstructions?.classList.add("hidden");
                  }
                }

                radioButtons.forEach((radio) => {
                  radio.addEventListener("change", updateSelection);
                });
                updateSelection();

                const importFile = document.getElementById(
                  "import-file",
                ) as HTMLInputElement;
                if (!importFile) throw new Error("Import file not found");

                importFile.addEventListener("change", async () => {
                  const files = importFile.files;
                  if (!files?.length) {
                    alert("Please select a file to import");
                    return;
                  }
                  try {
                    localStorage.removeItem("bookhive_import_results");
                  } catch {}

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
                  const progressEl =
                    document.getElementById("import-progress");
                  importLabel?.classList.add("hidden");
                  importingLabel?.classList.remove("hidden");
                  controls?.classList.add("hidden");
                  progressEl?.classList.remove("hidden");

                  const response = await fetch(endpoint, {
                    method: "POST",
                    body: form,
                  });
                  if (!response.ok || !response.body) {
                    throw new Error("Failed to import books");
                  }

                  const progressBar = document.getElementById("progress-bar");
                  const progressText =
                    document.getElementById("progress-text");
                  const progressCount =
                    document.getElementById("progress-count");
                  const currentBook =
                    document.getElementById("current-book");
                  const stageMessage =
                    document.getElementById("stage-message");
                  const completeCard =
                    document.getElementById("import-complete-card");
                  const completeCount =
                    document.getElementById("import-complete-count");
                  const shareLink = document.getElementById(
                    "import-share-link",
                  ) as HTMLAnchorElement;

                  try {
                    const reader = response.body
                      .pipeThrough(new TextDecoderStream())
                      .getReader();

                    const processEvent = (event: any) => {
                      if (
                        progressBar &&
                        progressText &&
                        progressCount &&
                        currentBook &&
                        stageMessage
                      ) {
                        switch (event.event) {
                          case "import-start":
                            progressText.textContent = "Starting import...";
                            stageMessage.textContent =
                              event.stageProgress?.message ?? "";
                            progressBar.style.width = "0%";
                            break;
                          case "book-load":
                            progressText.textContent = "Processing books...";
                            stageMessage.textContent =
                              event.stageProgress?.message ?? "";
                            progressCount.textContent = `${event.stageProgress?.current ?? 0} books processed`;
                            currentBook.textContent = `Current: ${event.title ?? ""} by ${event.author ?? ""}`;
                            break;
                          case "upload-start":
                            progressText.textContent = "Uploading books...";
                            stageMessage.textContent =
                              event.stageProgress?.message ?? "";
                            progressCount.textContent = `0/${event.stageProgress?.total ?? 0}`;
                            progressBar.style.width = "0%";
                            break;
                          case "book-upload": {
                            const pct =
                              event.total > 0
                                ? (event.processed / event.total) * 100
                                : 0;
                            progressBar.style.width = `${pct}%`;
                            progressText.textContent = "Uploading books...";
                            stageMessage.textContent =
                              event.stageProgress?.message ?? "";
                            progressCount.textContent = `${event.stageProgress?.current ?? 0}/${event.stageProgress?.total ?? 0}`;
                            currentBook.textContent = `Current: ${event.title ?? ""} by ${event.author ?? ""}`;
                            break;
                          }
                          case "import-complete":
                            progressBar.style.width = "100%";
                            progressText.textContent = "Import complete!";
                            stageMessage.textContent =
                              event.stageProgress?.message ?? "";
                            progressCount.textContent = `${event.stageProgress?.current ?? 0}/${event.stageProgress?.total ?? 0}`;
                            currentBook.textContent = "";

                            if (completeCard && completeCount && shareLink) {
                              const count =
                                event.stageProgress?.current ?? event.uploaded ?? 0;
                              completeCount.textContent = String(count);
                              shareLink.href = `https://bsky.app/intent/compose?text=${shareText}`;
                              completeCard.classList.remove("hidden");
                            }
                            break;
                        }
                      }

                      if (
                        event.event === "book-upload" &&
                        event.title &&
                        event.author
                      ) {
                        dispatchImportEvent({
                          event: "book-upload",
                          processed: event.processed,
                          total: event.total,
                          uploaded: event.uploaded,
                          stage: event.stage,
                          stageProgress: event.stageProgress,
                          book: {
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
                              event.alreadyExists ??
                              event.book?.alreadyExists,
                          },
                        });
                      } else if (
                        event.event === "import-start" ||
                        event.event === "upload-start"
                      ) {
                        dispatchImportEvent(event);
                      } else if (event.event === "import-complete") {
                        dispatchImportEvent(event);
                        if (event.failedBooks?.length) {
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
                    };

                    let buffer = "";
                    while (true) {
                      const { value, done } = await reader.read();
                      if (done) {
                        if (buffer.trim()) {
                          const data = buffer.replace(/^data: /, "").trim();
                          if (data) {
                            try {
                              processEvent(JSON.parse(data));
                            } catch (e) {
                              console.error(
                                "Failed to parse final SSE message:",
                                e,
                              );
                            }
                          }
                        }
                        break;
                      }
                      buffer += value;
                      const messages = buffer.split("\n\n");
                      buffer = messages.pop() || "";
                      for (const message of messages) {
                        if (!message.trim()) continue;
                        const data = message.replace(/^data: /, "").trim();
                        if (!data) continue;
                        try {
                          processEvent(JSON.parse(data));
                        } catch (e) {
                          console.error("Failed to parse SSE message:", e);
                        }
                      }
                    }
                  } catch (e) {
                    console.error("Stream reading failed:", e);
                    if (progressText)
                      progressText.textContent = "Import failed";
                    if (stageMessage)
                      stageMessage.textContent =
                        "An error occurred during import. Please try again.";
                    if (stageMessage)
                      stageMessage.classList.add("alert-destructive");
                  } finally {
                    importLabel?.classList.remove("hidden");
                    importingLabel?.classList.add("hidden");
                    const container =
                      document.getElementById("refresh-button");
                    if (container) {
                      container.innerHTML = "";
                      const reset = document.createElement("button");
                      reset.textContent = "Import more";
                      reset.className = "btn btn-primary btn-sm";
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
            />
          </label>
        </div>
      </div>

      {/* Post-import share prompt (hidden until import completes) */}
      <div
        id="import-complete-card"
        class="card mt-6 hidden"
      >
        <div class="card-header">
          <h3 class="text-lg font-semibold text-foreground">
            Import complete! <span id="import-complete-count">0</span> books
            added.
          </h3>
        </div>
        <div class="card-body">
          <p class="text-muted-foreground mb-4">
            Let your friends know you're on BookHive!
          </p>
          <a
            id="import-share-link"
            href={`https://bsky.app/intent/compose?text=${encodeURIComponent(SHARE_TEXT)}`}
            class="btn btn-primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Share on Bluesky
          </a>
        </div>
      </div>
    </div>
  );
};
