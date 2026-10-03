import { Hono } from "hono";
import { expect, test } from "bun:test";
import { BookCard } from "./BookCard";

test("workspace cards reserve text slots even without an author, without changing other grids", async () => {
  const book = {
    hiveId: "bk_fixture",
    title: "Short title",
    authors: "",
    cover: null,
    thumbnail: null,
    rating: 0,
  };
  const app = new Hono();
  app.get("/workspace", (c) =>
    c.html(<BookCard variant="dense" showAuthor reserveTextSpace book={book} />),
  );
  app.get("/normal", (c) => c.html(<BookCard variant="dense" showAuthor book={book} />));
  const workspace = await (await app.request("/workspace")).text();
  const normal = await (await app.request("/normal")).text();
  expect(workspace).toContain("h-[2.5em]");
  expect(workspace).toContain("h-[1.25em]");
  expect(normal).not.toContain("h-[2.5em]");
  expect(normal).not.toContain("h-[1.25em]");
});

test("dense card actions are outside the cover link and reveal on focus or no-hover devices", async () => {
  const card = (
    <BookCard
      variant="dense"
      book={{
        hiveId: "bk_fixture",
        title: "Fixture",
        authors: "Author",
        cover: null,
        thumbnail: null,
        rating: 0,
      }}
      overlay={
        <form action="/remove" method="post">
          <button type="submit">Remove</button>
        </form>
      }
    />
  );
  const app = new Hono();
  app.get("/", (c) => c.html(card));
  const html = await (await app.request("/")).text();
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
  expect(anchors.length).toBe(2);
  expect(anchors.every((anchor) => !anchor.includes("<form") && !anchor.includes("<button"))).toBe(
    true,
  );
  expect(html).toContain('action="/remove"');
  expect(html).toContain("group-focus-within:opacity-100");
  expect(html).toContain("[@media(hover:none)]:opacity-100");
  expect(html).toContain("pointer-events-none absolute inset-0");
  expect(html).toContain("[&amp;&gt;*]:pointer-events-auto");
});
