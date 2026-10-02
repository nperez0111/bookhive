import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { expect, test } from "bun:test";
import { ProfilePage } from "./profile";
import { BOOK_STATUS } from "../constants";
import type { Book } from "../types";

function book(status: string, pages: number | string | null, totalPages?: number): Book {
  return {
    cid: "fixture-cid",
    title: "Fixture book",
    authors: "Fixture Author",
    hiveId: "bk_fixture",
    uri: "at://did:plc:fixture/buzz.bookhive.book/fixture",
    userDid: "did:plc:fixture",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    indexedAt: "2026-01-01T00:00:00.000Z",
    meta: JSON.stringify({ numPages: pages }),
    bookProgress: totalPages ? { totalPages, updatedAt: "2026-01-01T00:00:00.000Z" } : null,
    owned: 0,
    startedAt: null,
    finishedAt: null,
    stars: null,
    review: null,
    previousReads: null,
    record: null,
    cover: null,
    thumbnail: null,
    description: null,
    rating: null,
    ratingsCount: null,
  };
}

async function pagesRead(books: Book[]): Promise<string | undefined> {
  const app = new Hono<{ Variables: { ctx: { getSessionAgent: () => Promise<null> } } }>();
  app.use(jsxRenderer());
  app.get("/", (c) => {
    c.set("ctx", { getSessionAgent: async () => null });
    return c.render(
      <ProfilePage
        handle="fixture.test"
        did="did:plc:fixture"
        profile={null}
        books={books}
        isBuzzer
      />,
      {},
    );
  });
  const response = await app.request("/");
  expect(response.status).toBe(200);
  const rendered = await response.text();
  return rendered
    .match(/tabular-nums">\s*([^<]+)\s*<\/div>\s*<div[^>]*>Pages Read<\/div>/)?.[1]
    ?.trim();
}

test("profile Pages Read sums finished books only using recorded edition pages first", async () => {
  expect(
    await pagesRead([
      book(BOOK_STATUS.FINISHED, "350"),
      book(BOOK_STATUS.FINISHED, 700, 200),
      book(BOOK_STATUS.FINISHED, null),
      book(BOOK_STATUS.WANTTOREAD, 900),
      book(BOOK_STATUS.READING, 600, 500),
      book(BOOK_STATUS.ABANDONED, 800),
    ]),
  ).toBe("550");
});

test("unread books alone do not produce a Pages Read total", async () => {
  expect(await pagesRead([book(BOOK_STATUS.WANTTOREAD, 900)])).toBe("—");
});
