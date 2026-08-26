import { describe, it, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { convert } from "../../vendor/boko/boko.js";
import { parseBook } from "./bookMetadata/index";
import { makeEpub } from "./bookMetadata/testFixtures";
import { convertToEpub, isConvertibleToEpub } from "./convertToEpub";

describe("isConvertibleToEpub", () => {
  it("claims the formats boko can actually read", () => {
    expect(isConvertibleToEpub("mobi")).toBe(true);
    expect(isConvertibleToEpub("MOBI")).toBe(true);
  });

  it("leaves EPUB alone", () => {
    expect(isConvertibleToEpub("epub")).toBe(false);
  });

  // The remaining gap in "only serve EPUBs": boko reads neither, so these still
  // reach an e-reader in their own format.
  it("does not claim FB2 or CBZ", () => {
    expect(isConvertibleToEpub("fb2")).toBe(false);
    expect(isConvertibleToEpub("cbz")).toBe(false);
  });

  it("tolerates a missing format", () => {
    expect(isConvertibleToEpub(null)).toBe(false);
    expect(isConvertibleToEpub(undefined)).toBe(false);
    expect(isConvertibleToEpub("")).toBe(false);
  });
});

/**
 * Above `convertInWorker`'s own 60s deadline, so a slow machine sees the
 * converter's error rather than bun's. These tests spawn a real Worker and
 * instantiate a 2 MB WASM module; the default 5s is startup cost, not
 * conversion time, and would flake on a loaded CI box while the code under
 * test was working correctly.
 */
const WORKER_TEST_TIMEOUT_MS = 90_000;

describe("convertToEpub", () => {
  const withTmpDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = await mkdtemp(path.join(tmpdir(), "convert-test-"));
    try {
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("refuses a format it cannot convert without spawning a worker", async () => {
    const result = await convertToEpub("/nonexistent/in.epub", "/nonexistent/out.epub", "epub");
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  /**
   * End-to-end through the real Worker and the real WASM module, with no
   * checked-in binary fixture: boko can *write* AZW3, so a synthetic EPUB is
   * round-tripped out to Kindle format and back. Exercises the whole path —
   * `convertToEpub` → `convertInWorker` → Worker → `vendor/boko` → written file.
   */
  it(
    "round-trips a real Kindle file back to a readable EPUB",
    async () => {
      await withTmpDir(async (dir) => {
        const source = makeEpub({ title: "Round Trip", authors: ["A. Converter"] });
        const kindlePath = path.join(dir, "book.mobi");
        await Bun.write(kindlePath, convert(source, "epub", "azw3"));

        const destPath = path.join(dir, "book.epub");
        const result = await convertToEpub(kindlePath, destPath, "mobi");

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.sizeBytes).toBeGreaterThan(0);

        // The real assertion: our own parser reads what the converter produced.
        const bytes = new Uint8Array(await Bun.file(destPath).arrayBuffer());
        const parsed = parseBook(bytes, "book.epub");
        expect(parsed.title).toBe("Round Trip");
      });
    },
    WORKER_TEST_TIMEOUT_MS,
  );

  it(
    "reports a corrupt file as failed, without throwing",
    async () => {
      await withTmpDir(async (dir) => {
        const src = path.join(dir, "in.mobi");
        await Bun.write(src, "definitely not a mobi");
        const result = await convertToEpub(src, path.join(dir, "out.epub"), "mobi");
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("failed");
          // Not "timeout": a converter that rejected the header immediately must
          // not look like a 60s hang to whoever reads the wide event.
          expect(result.detail).toBeTruthy();
        }
      });
    },
    WORKER_TEST_TIMEOUT_MS,
  );

  it(
    "reports a missing source file as failed rather than crashing the upload",
    async () => {
      await withTmpDir(async (dir) => {
        const result = await convertToEpub(
          path.join(dir, "absent.mobi"),
          path.join(dir, "out.epub"),
          "mobi",
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("failed");
      });
    },
    WORKER_TEST_TIMEOUT_MS,
  );

  it(
    "never reports success without a file behind it",
    async () => {
      // `epubPath` is written from this result, and a path with nothing behind it
      // is a dead download on the web library, the OPDS feed and the XRPC view.
      await withTmpDir(async (dir) => {
        const src = path.join(dir, "in.mobi");
        await Bun.write(src, convert(makeEpub({ title: "Exists" }), "epub", "azw3"));
        const destPath = path.join(dir, "out.epub");
        const result = await convertToEpub(src, destPath, "mobi");
        expect(result.ok).toBe(true);
        expect(await Bun.file(destPath).exists()).toBe(true);
      });
    },
    WORKER_TEST_TIMEOUT_MS,
  );
});
