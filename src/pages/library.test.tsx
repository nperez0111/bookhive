import { describe, it, expect } from "bun:test";

import { LibraryPage } from "./library";

const render = async (node: unknown): Promise<string> => String(await (node as string));

describe("LibraryPage", () => {
  describe("with no books and no synced documents", () => {
    const page = () =>
      render(<LibraryPage handle="alice.bsky.social" bookCount={0} syncDocCount={0} />);

    it("explains the feature and puts setup inline instead of behind modals", async () => {
      const html = await page();
      expect(html).toContain("OPDS catalog");
      expect(html).toContain("Connect your e-reader");
      expect(html).toContain("Add your first book");
      // No dialogs, and therefore no triggers to open them.
      expect(html).not.toContain("<dialog");
      expect(html).not.toContain("showModal");
    });

    it("does not mount the library manager island", async () => {
      expect(await page()).not.toContain("mount-library-manager");
    });

    it("shows the credentials and upload form", async () => {
      const html = await page();
      expect(html).toContain("alice.bsky.social");
      expect(html).toContain('action="/library/upload"');
      expect(html).toContain("sync-password");
    });
  });

  describe("with existing content", () => {
    const page = () =>
      render(<LibraryPage handle="alice.bsky.social" bookCount={3} syncDocCount={0} />);

    it("moves setup behind dialog triggers", async () => {
      const html = await page();
      expect(html).toContain('id="ereader-dialog"');
      expect(html).toContain('id="upload-dialog"');
      // Quotes are entity-escaped in the rendered attribute.
      expect(html).toContain("getElementById(&#39;ereader-dialog&#39;).showModal()");
      expect(html).toContain("getElementById(&#39;upload-dialog&#39;).showModal()");
    });

    it("mounts the library manager island", async () => {
      expect(await page()).toContain('id="mount-library-manager"');
    });

    it("still renders the credentials and upload form, inside the dialogs", async () => {
      const html = await page();
      expect(html).toContain("alice.bsky.social");
      expect(html).toContain('action="/library/upload"');
    });
  });

  it("uses the populated layout when only synced documents exist", async () => {
    // Progress can arrive from an e-reader before anything is uploaded; that
    // still needs the manager so the user can triage those documents.
    const html = await render(
      <LibraryPage handle="alice.bsky.social" bookCount={0} syncDocCount={2} />,
    );
    expect(html).toContain('id="mount-library-manager"');
  });
});
