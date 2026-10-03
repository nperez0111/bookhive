import { describe, it, expect, test } from "bun:test";
import { Hono } from "hono";
import { LibraryPage } from "./library";

const render = async (node: unknown): Promise<string> =>
  String(await (node as string | Promise<string>));

describe("LibraryPage", () => {
  describe("with no books and no synced documents", () => {
    const page = () =>
      render(<LibraryPage handle="alice.bsky.social" bookCount={0} syncDocCount={0} />);
    it("explains the feature and puts setup inline instead of behind modals", async () => {
      const html = await page();
      expect(html).toContain("OPDS catalog");
      expect(html).toContain("Connect your e-reader");
      expect(html).toContain("Add your first book");
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
  describe("upload error alert", () => {
    it("renders the reason a plain form post failed, in both layouts", async () => {
      for (const bookCount of [0, 3]) {
        const html = await render(
          <LibraryPage
            handle="alice.bsky.social"
            bookCount={bookCount}
            syncDocCount={0}
            uploadError="QuotaExceeded"
          />,
        );
        expect(html).toContain("Your library is full");
        expect(html).toContain('role="alert"');
      }
    });
    it("falls back to a generic message for an unknown code", async () => {
      const html = await render(
        <LibraryPage
          handle="alice.bsky.social"
          bookCount={3}
          syncDocCount={0}
          uploadError="SomethingNew"
        />,
      );
      expect(html).toContain("didn&#39;t work");
    });
    it("renders no alert when there is no error", async () => {
      const html = await render(
        <LibraryPage handle="alice.bsky.social" bookCount={3} syncDocCount={0} />,
      );
      expect(html).not.toContain('role="alert"');
    });
  });
  it("uses the populated layout when only synced documents exist", async () => {
    const html = await render(
      <LibraryPage handle="alice.bsky.social" bookCount={0} syncDocCount={2} />,
    );
    expect(html).toContain('id="mount-library-manager"');
  });
});

for (const bookCount of [0, 1]) {
  test(`e-reader credentials keep wrap-safe values in the ${bookCount ? "dialog" : "inline setup"}`, async () => {
    const app = new Hono();
    app.get("/", (c) =>
      c.html(
        <LibraryPage
          handle="a-long-reader-handle.example.com"
          bookCount={bookCount}
          syncDocCount={0}
        />,
      ),
    );
    const html = await (await app.request("/")).text();
    for (const id of ["sync-server-url", "opds-url", "sync-username"]) {
      const code = html.match(new RegExp(`<code[^>]*id="${id}"[^>]*>`))?.[0];
      expect(code).toContain("min-w-0");
      expect(code).toContain("flex-1");
      expect(code).toContain("break-all");
      expect(html).toContain(`data-copy="${id}"`);
    }
    expect(html.match(/<summary[^>]*>/)?.[0]).toContain("min-h-10");
  });
}
