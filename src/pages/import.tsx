import { type FC } from "hono/jsx";
import { Script } from "./utils/script";

export const LibraryImport: FC = () => {
  return (
    <div class="space-y-6">
      {/* Dynamic table mount; hidden until import starts */}
      <div id="import-table" class="hidden" />

      <div id="import-card" class="card">
        <div class="card-body">
          <h2 class="card-title mb-6">Import your library</h2>

          {/* Service Selection: radio group with visual cards */}
          <div class="mb-6">
            <p class="text-muted-foreground mb-3 text-sm">Choose where to import from</p>
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
                  <span class="font-medium text-foreground">From Goodreads</span>
                </div>
              </label>
              <label class="flex cursor-pointer">
                <input type="radio" name="import-service" value="storygraph" class="peer sr-only" />
                <div class="card flex flex-1 items-center border-2 px-4 py-3 transition-colors peer-checked:border-primary peer-checked:bg-primary/5 hover:border-border min-w-[140px]">
                  <span class="font-medium text-foreground">From StoryGraph</span>
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
            <input id="import-file" type="file" name="export" accept=".csv" class="hidden" />
            <Script
              script={(document) => {
                const shareText = encodeURIComponent(
                  "I just imported my reading list to BookHive! 📚 https://bookhive.social",
                );

                function dispatchImportEvent(detail: any) {
                  window.dispatchEvent(new CustomEvent("bookhive:import-event", { detail }));
                  const table = document.getElementById("import-table");
                  const importCard = document.getElementById("import-card");
                  if (table?.classList.contains("hidden")) {
                    table.classList.remove("hidden");
                    importCard?.classList.add("hidden");
                  }
                }

                const radioButtons = document.querySelectorAll(
                  'input[name="import-service"]',
                ) as NodeListOf<HTMLInputElement>;
                const goodreadsInstructions = document.getElementById("goodreads-instructions");
                const storygraphInstructions = document.getElementById("storygraph-instructions");

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

                const importFile = document.getElementById("import-file") as HTMLInputElement;
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
                  form.append("export", files[0]!);

                  // Hide the card immediately and show the import table
                  const importCard = document.getElementById("import-card");
                  const table = document.getElementById("import-table");
                  importCard?.classList.add("hidden");
                  table?.classList.remove("hidden");

                  dispatchImportEvent({ event: "import-start", stageProgress: { message: "Starting import..." } });

                  try {
                    const response = await fetch(endpoint, {
                      method: "POST",
                      body: form,
                    });
                    if (!response.ok || !response.body) {
                      throw new Error("Failed to import books");
                    }

                    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

                    const processEvent = (event: any) => {
                      // Forward book-load events for progress tracking
                      if (event.event === "book-load") {
                        dispatchImportEvent(event);
                      } else if (event.event === "book-upload" && event.title && event.author) {
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
                            coverImage: event.coverImage || event.book?.coverImage,
                            status: event.status || event.book?.status,
                            finishedAt: event.finishedAt || event.book?.finishedAt,
                            stars: event.stars ?? event.book?.stars,
                            review: event.review ?? event.book?.review,
                            alreadyExists: event.alreadyExists ?? event.book?.alreadyExists,
                          },
                        });
                      } else if (event.event === "import-error") {
                        dispatchImportEvent(event);
                      } else if (event.event === "import-complete") {
                        dispatchImportEvent({ ...event, shareText });
                        if (event.failedBooks?.length) {
                          for (let i = 0; i < event.failedBooks.length; i++) {
                            const fb = event.failedBooks[i];
                            const details = event.failedBookDetails?.[i] || {};
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
                              console.error("Failed to parse final SSE message:", e);
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
                    dispatchImportEvent({
                      event: "import-error",
                      error: "An error occurred during import. Please try again.",
                    });
                  }
                });
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
};
