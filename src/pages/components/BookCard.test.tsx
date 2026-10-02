import { Hono } from "hono";
import { expect, test } from "bun:test";
import { BookCard } from "./BookCard";

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
