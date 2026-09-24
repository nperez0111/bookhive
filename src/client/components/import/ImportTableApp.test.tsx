import { expect, test } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { ProgressCard, progressAfterImportError, type ProgressState } from "./ImportTableApp";

const starting: ProgressState = {
  stage: "starting",
  current: 0,
  total: 0,
  message: "Starting import...",
};

test("terminal import failure replaces running progress and offers retry without success or sharing", () => {
  const progress = progressAfterImportError(starting, {
    event: "import-error",
    stage: "error",
    error: "Choose a Goodreads CSV export.",
  });
  expect(progress?.stage).toBe("error");
  const html = renderToString(<ProgressCard progress={progress!} onImportMore={() => {}} />);
  expect(html).toContain("Import failed");
  expect(html).toContain("Choose a Goodreads CSV export.");
  expect(html).toContain("Try again");
  expect(html).not.toContain("animate-spin");
  expect(html).not.toContain("Starting import");
  expect(html).not.toContain("Import complete");
  expect(html).not.toContain("bsky.app");
});

test("per-book uploading errors preserve running progress", () => {
  const saving: ProgressState = { stage: "saving", current: 3, total: 10, uploadedCount: 2 };
  expect(
    progressAfterImportError(saving, {
      event: "import-error",
      stage: "uploading",
      error: "One book failed",
    }),
  ).toBe(saving);
  expect(
    progressAfterImportError(saving, { event: "import-error", error: "One book failed" }),
  ).toBe(saving);
});
