import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { expect, test } from "bun:test";
import { ProfilePage } from "./profile";
import { BOOK_STATUS } from "../constants";
import type { Book } from "../types";
import { UserBlock } from "./components/cards/UserBlock";
import { ReadingStatsPage } from "./readingStats";
import { computeReadingStats } from "../data/readingStats";
import { actorLinkId } from "./utils/actorLinkId";
import { Sidebar } from "./sidebar";

test("actor links select the first usable handle and never route missing or placeholder handles", () => {
  expect(actorLinkId("did:plc:fixture", "renamed.test", "old.test")).toBe("renamed.test");
  expect(actorLinkId("did:plc:fixture", "handle.invalid", "old.test")).toBe("old.test");
  expect(actorLinkId("did:plc:fixture", null, undefined, "not-a-handle", "handle.invalid")).toBe(
    "did:plc:fixture",
  );
});

test.each(["fixture.test", "handle.invalid"])(
  "sidebar shelf links prefer usable handles with DID fallback: %s",
  async (handle) => {
    const app = new Hono().get("/", (c) =>
      c.html(<Sidebar currentPath="/home" user={{ did: "did:plc:fixture", handle }} />),
    );
    const html = await (await app.request("/")).text();
    expect(html).toContain(
      `href="/shelves/${handle === "fixture.test" ? handle : "did:plc:fixture"}"`,
    );
    expect(html).not.toContain('href="/shelves/handle.invalid"');
  },
);

test.each(["fixture.test", "handle.invalid"])(
  "user links prefer usable handles with DID fallback: %s",
  async (handle) => {
    const app = new Hono();
    app.get("/", (c) => c.html(<UserBlock did="did:plc:fixture" handle={handle} />));
    const html = await (await app.request("/")).text();
    expect(html).toContain(
      `href="/profile/${handle === "fixture.test" ? handle : "did:plc:fixture"}"`,
    );
    expect(html).not.toContain('href="/profile/handle.invalid"');
  },
);

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

async function renderProfile(books: Book[], handle = "fixture.test"): Promise<string> {
  const app = new Hono<{ Variables: { ctx: { getSessionAgent: () => Promise<null> } } }>();
  app.use(jsxRenderer());
  app.get("/", (c) => {
    c.set("ctx", { getSessionAgent: async () => null });
    return c.render(
      <ProfilePage handle={handle} did="did:plc:fixture" profile={null} books={books} isBuzzer />,
      {},
    );
  });
  const response = await app.request("/");
  expect(response.status).toBe(200);
  return response.text();
}

async function pagesRead(books: Book[]): Promise<string | undefined> {
  return (await renderProfile(books))
    .match(/tabular-nums">\s*([^<]+)\s*<\/div>\s*<div[^>]*>Pages Read<\/div>/)?.[1]
    ?.trim();
}

test.each(["fixture.test", "handle.invalid"])(
  "profile navigation and sharing prefer usable handles: %s",
  async (handle) => {
    const html = await renderProfile([], handle);
    const actor = handle === "fixture.test" ? handle : "did:plc:fixture";
    expect(html).toContain(`href="/profile/${actor}/stats/`);
    expect(html).toContain(`data-copy-url="/profile/${actor}"`);
    expect(html).toContain(`data-copy-url="/rss/user/${actor}"`);
    expect(html).toContain(`href="https://bsky.app/profile/${actor}"`);
    expect(html).toContain(encodeURIComponent(`https://bookhive.buzz/profile/${actor}`));
    expect(html).not.toMatch(/(?:href|action)="\/(?:profile|shelves)\/handle\.invalid/);
  },
);

test.each(["fixture.test", "handle.invalid"])(
  "reading stats links prefer usable handles: %s",
  async (handle) => {
    const app = new Hono().get("/", (c) =>
      c.html(
        <ReadingStatsPage
          handle={handle}
          did="did:plc:fixture"
          year={2025}
          stats={computeReadingStats([], [])}
          profile={null}
          isOwnProfile={false}
          availableYears={[2024, 2025]}
          books={[]}
          showYearInBooks={false}
        />,
      ),
    );
    const html = await (await app.request("/")).text();
    for (const path of ["", "/stats", "/stats/2024", "/stats/2025"]) {
      expect(html).toContain(
        `href="/profile/${handle === "fixture.test" ? handle : "did:plc:fixture"}${path}"`,
      );
    }
    expect(html).not.toContain('href="/profile/handle.invalid');
  },
);

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
