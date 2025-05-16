import { type FC } from "hono/jsx";
import { Script } from "../utils/script";

export const GoodreadsImport: FC = () => {
  return (
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
              const importingLabel = document.getElementById("importing-label");
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
              const progressText = document.getElementById("progress-text");
              const progressCount = document.getElementById("progress-count");
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
                        const progress = (event.processed / event.total) * 100;
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
  );
};
