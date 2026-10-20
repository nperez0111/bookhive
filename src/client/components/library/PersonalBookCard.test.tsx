import { expect, test } from "bun:test";
import { Hono } from "hono";
import { PersonalBookCard } from "./PersonalBookCard";
import type { PersonalBook } from "./types";

const book: PersonalBook = {
  contentHash: "fixture-hash",
  title: "Touch controls",
  authors: "Test Author",
  language: "en",
  format: "epub",
  mime: "application/epub+zip",
  sizeBytes: 1024,
  coverUrl: null,
  hiveId: "bk_fixture",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

async function renderCard(hiveId: string | null) {
  const noop = () => {};
  const app = new Hono();
  app.get("/", (c) =>
    c.html(
      <PersonalBookCard
        book={{ ...book, hiveId }}
        shelves={[]}
        activeShelfId={null}
        onLink={noop}
        onUnlink={noop}
        onDelete={noop}
        onAddToShelf={noop}
        onRemoveFromShelf={noop}
      />,
    ),
  );
  return (await app.request("/")).text();
}

test("personal library actions are visible for touch and keyboard, with a 40px menu trigger", async () => {
  const html = await renderCard(book.hiveId);
  // Both the action layer and its contrast scrim must reveal without hover.
  expect(html.match(/\[@media\(hover:none\)\]:opacity-100/g)).toHaveLength(2);
  expect(html.match(/\[@media\(pointer:coarse\)\]:opacity-100/g)).toHaveLength(2);
  expect(html.match(/max-md:opacity-100/g)).toHaveLength(2);
  expect(html).toContain("group-focus-within:opacity-100");
  expect(html).toMatch(
    /<label for="personal-book-menu-fixture-hash" class="[^"]*min-h-10 min-w-10/,
  );
  expect(html).toContain('type="checkbox" id="personal-book-menu-fixture-hash"');
  expect(html).toContain("peer-checked:visible");
});

test("one menu exposes download and the linked BookHive page outside cover anchors", async () => {
  const html = await renderCard(book.hiveId);
  const menu = html.slice(html.indexOf("data-menu-panel"));
  expect(menu).toContain('href="/library/books/fixture-hash/download"');
  expect(menu).toContain("download");
  expect(menu).toContain('href="/books/bk_fixture"');
  expect(menu).toContain("View on BookHive");
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)];
  expect(anchors.every(([anchor]) => !anchor.includes("<form"))).toBe(true);
});

test("unlinked files retain download and linking without a broken BookHive link", async () => {
  const html = await renderCard(null);
  expect(html).toContain('href="/library/books/fixture-hash/download"');
  expect(html).toContain("Link to a BookHive book");
  expect(html).not.toContain("View on BookHive");
});
