import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { timing } from "hono/timing";
import type { AppEnv } from "../context";
import type { SessionClient } from "../auth/client";
import { createTestDb, testContext } from "../test/db";
import { getListWithItems, updateList } from "../services/lists";
import { ShelfEditPage, ShelfViewPage } from "../pages/shelves";
import shelves from "./shelves";

const did = "did:plc:shelfowner";
const listUri = `at://${did}/social.popfeed.feed.list/test`;
const uris = ["a", "b", "c"].map((key) => `at://${did}/social.popfeed.feed.listItem/${key}`);
const now = "2026-10-04T12:00:00.000Z";

describe("ranked shelf ordering", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  const get = mock(async () => ({
    ok: true,
    data: {
      value: {
        $type: "social.popfeed.feed.list",
        name: "Ranked",
        ordered: true,
        createdAt: now,
        extra: "preserved",
      },
    },
  }));
  const post = mock(async (_method: string, _args: unknown) => ({
    ok: true,
    data: { results: [{ $type: "com.atproto.repo.applyWrites#updateResult", cid: "new-cid" }] },
  }));

  beforeEach(async () => {
    testDb = await createTestDb();
    get.mockClear();
    post.mockClear();
    await testDb.db
      .insertInto("book_list")
      .values({
        uri: listUri,
        cid: "old",
        userDid: did,
        name: "Ranked",
        ordered: 1,
        createdAt: now,
        indexedAt: now,
      })
      .execute();
    await testDb.db
      .insertInto("book_list_item")
      .values(
        uris.map((uri, position) => ({
          uri,
          cid: "old",
          userDid: did,
          listUri,
          position,
          addedAt: now,
          indexedAt: now,
          embeddedTitle: `Book ${position + 1}`,
        })),
      )
      .execute();
  });
  afterEach(async () => {
    await testDb.close();
  });

  function app(owner: string | null = did) {
    const app = new Hono<AppEnv>();
    app.use(timing());
    app.use(jsxRenderer());
    app.use("*", async (c, next) => {
      const ctx = testContext({
        db: testDb.db,
        getSessionAgent: async () =>
          owner ? ({ did: owner, get, post } as unknown as SessionClient) : null,
      });
      // Directory rendering must not fetch a profile over the network.
      await ctx.kv.setItem(`profile:pub:${did}`, {
        profile: { did, handle: "shelfowner.test" },
        fetchedAt: Date.now(),
      });
      c.set("ctx", ctx);
      await next();
    });
    app.route("/shelves", shelves);
    return app;
  }
  const request = (itemUris: string[], owner: string | null = did) =>
    app(owner).request(`/shelves/${did}/test/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemUris }),
    });

  it("renders complete counts but only ten deterministic embedded previews", async () => {
    await testDb.db
      .insertInto("book_list_item")
      .values(
        Array.from({ length: 9 }, (_, index) => ({
          uri: `at://${did}/social.popfeed.feed.listItem/z${index}`,
          cid: "cid",
          userDid: did,
          listUri,
          addedAt: now,
          indexedAt: now,
          embeddedTitle: `Extra title ${index}`,
          embeddedAuthor: "Fallback author",
          embeddedCoverUrl: "https://example.test/fallback.jpg",
        })),
      )
      .execute();
    const response = await app().request(`/shelves/${did}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("12 books");
    expect(html).toContain("Extra title 6");
    expect(html).not.toContain("Extra title 7");
    expect(html).not.toContain("Extra title 8");
    expect(html).toContain("Book 1");
    expect(html).toContain("Fallback author");
  });

  it("edits only metadata, preserving ownership and missing-shelf responses", async () => {
    testDb.sqlite.exec("DROP TABLE book_list_item; DROP TABLE hive_book");
    const response = await app().request(`/shelves/${did}/test/edit`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('value="Ranked"');
    expect((await app(null).request(`/shelves/${did}/test/edit`)).status).toBe(302);
    expect((await app("did:plc:stranger").request(`/shelves/${did}/test/edit`)).status).toBe(403);
    expect((await app().request(`/shelves/${did}/missing/edit`)).status).toBe(404);
  });

  it("saves Popfeed itemOrder and reads it ahead of item positions, even after re-sync", async () => {
    const order = [uris[2]!, uris[0]!, uris[1]!];
    expect((await request(order)).status).toBe(200);
    const input = post.mock.calls[0]![1] as {
      input: { writes: Array<{ value: Record<string, unknown> }> };
    };
    expect(input.input.writes[0]!.value).toMatchObject({ itemOrder: order, extra: "preserved" });
    await testDb.db.updateTable("book_list_item").set({ position: null }).execute();
    const result = await getListWithItems({ db: testDb.db, listUri });
    expect(result!.items.map((item) => item.uri)).toEqual(order);
    expect(result!.list.cid).toBe("new-cid");
  });
  it("rejects unauthenticated and non-owner writes", async () => {
    expect((await request(uris, null)).status).toBe(401);
    expect((await request(uris, "did:plc:stranger")).status).toBe(403);
    expect(post).not.toHaveBeenCalled();
  });
  it("refreshes external metadata before saving the confirmed CID", async () => {
    get.mockImplementationOnce(async () => ({
      ok: true,
      data: {
        value: {
          $type: "social.popfeed.feed.list",
          name: "Renamed on Popfeed",
          description: "External description",
          tags: ["favorite"],
          ordered: true,
          createdAt: now,
          extra: "preserved",
        },
      },
    }));
    expect((await request([...uris].reverse())).status).toBe(200);
    const row = (await getListWithItems({ db: testDb.db, listUri }))!.list;
    expect(row).toMatchObject({
      cid: "new-cid",
      name: "Renamed on Popfeed",
      description: "External description",
      tags: JSON.stringify(["favorite"]),
    });
  });
  it("preserves canonical fields when updating only one shelf field", async () => {
    get.mockImplementationOnce(async () => ({
      ok: true,
      data: {
        value: {
          $type: "social.popfeed.feed.list",
          name: "Renamed on Popfeed",
          description: "External description",
          tags: ["favorite"],
          itemOrder: [...uris].reverse(),
          ordered: false,
          createdAt: now,
          extra: "preserved",
        },
      },
    }));
    const result = await updateList({
      db: testDb.db,
      agent: { did, get, post } as unknown as SessionClient,
      uri: listUri,
      description: "Edited here",
    });
    expect(result.ok).toBe(true);
    expect((await getListWithItems({ db: testDb.db, listUri }))!.list).toMatchObject({
      cid: "new-cid",
      name: "Renamed on Popfeed",
      description: "Edited here",
      ordered: 0,
      tags: JSON.stringify(["favorite"]),
      itemOrder: JSON.stringify([...uris].reverse()),
    });
    const input = post.mock.calls[0]![1] as {
      input: { writes: Array<{ value: Record<string, unknown> }> };
    };
    expect(input.input.writes[0]!.value["extra"]).toBe("preserved");
  });
  it("rejects duplicates, foreign items, missing items and invalid JSON shapes", async () => {
    for (const order of [
      [uris[0]!, uris[0]!, uris[2]!],
      [uris[0]!, uris[1]!, "foreign"],
      uris.slice(0, 2),
    ]) {
      expect((await request(order)).status).toBe(400);
    }
    const res = await app().request(`/shelves/${did}/test/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemUris: "invalid" }),
    });
    expect(res.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it("keeps the confirmed order when the PDS rejects a write", async () => {
    post.mockImplementationOnce(async () => ({ ok: false, data: { results: [] } }));
    expect((await request([...uris].reverse())).status).toBe(502);
    const result = await getListWithItems({ db: testDb.db, listUri });
    expect(result!.list.itemOrder).toBeNull();
    expect(result!.items.map((item) => item.uri)).toEqual(uris);
  });
  it("does not mirror an unconfirmed PDS response", async () => {
    post.mockImplementationOnce(async () => ({ ok: true, data: { results: [] } }));
    expect((await request([...uris].reverse())).status).toBe(502);
    expect((await getListWithItems({ db: testDb.db, listUri }))!.list.itemOrder).toBeNull();
  });
  it("honors externally synced order and appends unlisted books deterministically", async () => {
    await testDb.db
      .updateTable("book_list")
      .set({ itemOrder: JSON.stringify(["deleted-item", uris[2], uris[0]]) })
      .where("uri", "=", listUri)
      .execute();
    const result = await getListWithItems({ db: testDb.db, listUri });
    expect(result!.items.map((item) => item.uri)).toEqual([uris[2]!, uris[0]!, uris[1]!]);
  });
  it("renders owner controls only for populated ranked shelves, hidden until JS initializes", async () => {
    const result = (await getListWithItems({ db: testDb.db, listUri }))!;
    const render = async (isOwner: boolean, ordered: number, handle = "handle.invalid") => {
      const page = new Hono().get("/", (c) =>
        c.html(
          <ShelfViewPage
            {...result}
            list={{ ...result.list, ordered }}
            handle={handle}
            isOwner={isOwner}
            profile={null}
          />,
        ),
      );
      return (await page.request("/")).text();
    };
    const html = await render(true, 1);
    expect(html).toContain("Reorder books");
    expect(html).toContain('data-order-toolbar="true" hidden=""');
    expect(html).toContain("Enable JavaScript");
    for (const suffix of ["", "/edit", "/delete", "/remove"]) {
      expect(html).toContain(`="/shelves/${did}/test${suffix}"`);
    }
    expect(html).toContain(`data-reorder-url="/shelves/${did}/test/reorder"`);
    expect(html).toContain(`href="/profile/${did}"`);
    expect(html).not.toMatch(/(?:href|action|data-reorder-url)="[^"]*handle\.invalid/);
    const readable = await render(true, 1, "shelfowner.test");
    expect(readable).toContain('href="/shelves/shelfowner.test/test/edit"');
    expect(readable).toContain('action="/shelves/shelfowner.test/test/delete"');
    expect(readable).toContain('href="/profile/shelfowner.test"');
    const editApp = new Hono().get("/", (c) =>
      c.html(<ShelfEditPage list={result.list} handle="handle.invalid" />),
    );
    const editHtml = await (await editApp.request("/")).text();
    expect(editHtml).toContain(`action="/shelves/${did}/test/edit"`);
    expect(editHtml).toContain(`href="/shelves/${did}/test"`);
    expect(await render(false, 1)).not.toContain("Reorder books");
    expect(await render(true, 0)).not.toContain("Reorder books");
  });
});
