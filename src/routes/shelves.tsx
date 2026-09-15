/**
 * Book Shelves routes. Mount at /shelves.
 * Handles shelf CRUD via form submissions and SSR pages.
 */
import { resolveActorDid } from "../services/actor";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { endTime, startTime } from "hono/timing";
import { z } from "zod";

import type { AppEnv } from "../context";
import { renderError } from "./errorPage";
import { ShelfViewPage, ShelfCreatePage, ShelfEditPage } from "../pages/shelves";
import {
  createList,
  updateList,
  deleteList,
  addBookToList,
  removeBookFromList,
  type ListFailure,
  getUserLists,
  getListWithItems,
} from "../services/lists";
import type { HiveBook, HiveId } from "../types";
import { getProfile } from "../services/getProfile";
import { searchBooks } from "../services/searchBooks";
import { hydrateSearchResults, searchLocalCatalog } from "../data/catalogBooks";

/**
 * The core's refusal reasons → an error page. Mirrors `listErrorFor` in the
 * XRPC router: the core owns the rules, each adapter owns its status codes.
 * This also lets the handlers below drop their own ownership checks, which
 * used to be reimplemented here because `lists.ts` threw a bare `Error`
 * indistinguishable from a genuine failure.
 */
function renderListFailure(c: Context<AppEnv>, result: ListFailure) {
  const status =
    result.reason === "not_owner" ? 403 : result.reason === "pds_write_failed" ? 502 : 404;
  return renderError(c, {
    status,
    message: result.reason === "not_owner" ? "Not authorized" : result.message,
    description: result.message,
    title: result.reason === "not_owner" ? "Not Authorized" : "Error",
  });
}

const app = new Hono<AppEnv>()
  // Create shelf form page
  .get("/new", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.redirect("/login");
    }
    return c.render(<ShelfCreatePage />, {
      title: "BookHive | Create a Shelf",
    });
  })

  // Create shelf handler
  .post(
    "/new",
    zValidator(
      "form",
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        ordered: z.string().optional(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.redirect("/login");
      }
      const { name, description, ordered } = c.req.valid("form");
      try {
        startTime(c, "createList");
        const created = await createList({
          agent,
          db: c.get("ctx").db,
          name,
          description: description || undefined,
          ordered: ordered === "on",
        });
        endTime(c, "createList");
        if (!created.ok) return renderListFailure(c, created);
        const uri = created.uri;
        const rkey = uri.split("/").at(-1)!;
        const handle = await c.get("ctx").resolver.resolveDidToHandle(agent.did);
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        c.set("requestError", e);
        return renderError(c, {
          status: 500,
          message: "Failed to create shelf",
          description: (e as Error).message,
          title: "Error",
        });
      }
    },
  )

  // View a user's shelves
  .get("/:handle", async (c) => {
    const handle = c.req.param("handle");
    startTime(c, "resolveDid");
    const did = await resolveActorDid(c.get("ctx"), handle);
    endTime(c, "resolveDid");

    if (!did) {
      return renderError(c, {
        status: 404,
        message: "User not found",
        description: "This user does not exist.",
        title: "User Not Found",
      });
    }

    startTime(c, "getUserLists");
    startTime(c, "getProfile");
    const [lists, profile, sessionAgent] = await Promise.all([
      getUserLists({ db: c.get("ctx").db, userDid: did }).then((r) => {
        endTime(c, "getUserLists");
        return r;
      }),
      getProfile({ ctx: c.get("ctx"), did }).then((r) => {
        endTime(c, "getProfile");
        return r;
      }),
      c.get("ctx").getSessionAgent(),
    ]);

    const previewsByList = new Map<
      string,
      Array<{
        cover: string | null;
        thumbnail: string | null;
        embeddedCoverUrl: string | null;
        embeddedTitle: string | null;
        embeddedAuthor: string | null;
        hiveId: string | null;
        title: string | null;
        authors: string | null;
        rating: number | null;
      }>
    >();
    if (lists.length > 0) {
      const listUris = lists.map((l) => l.uri);
      startTime(c, "shelfPreviews");
      const previewItems = await c
        .get("ctx")
        .db.selectFrom("book_list_item")
        .leftJoin("hive_book", "book_list_item.hiveId", "hive_book.id")
        .select([
          "book_list_item.listUri",
          "book_list_item.hiveId",
          "book_list_item.embeddedTitle",
          "book_list_item.embeddedAuthor",
          "book_list_item.embeddedCoverUrl",
          "hive_book.cover",
          "hive_book.thumbnail",
          "hive_book.title",
          "hive_book.authors",
          "hive_book.rating",
        ])
        .where("book_list_item.listUri", "in", listUris)
        .orderBy("book_list_item.addedAt", "desc")
        .execute();
      endTime(c, "shelfPreviews");
      for (const item of previewItems) {
        const arr = previewsByList.get(item.listUri) ?? [];
        if (arr.length < 10) arr.push(item);
        previewsByList.set(item.listUri, arr);
      }
    }

    return c.render(
      <ShelvesListPage
        handle={handle}
        lists={lists}
        isOwnProfile={sessionAgent?.did === did}
        profile={profile}
        previewsByList={previewsByList}
      />,
      {
        title: `BookHive | @${handle}'s Shelves`,
        description: `@${handle}'s book shelves on BookHive`,
      },
    );
  })

  // View single shelf
  .get("/:handle/:rkey", async (c) => {
    const handle = c.req.param("handle");
    const rkey = c.req.param("rkey");

    startTime(c, "resolveDid");
    const did = await resolveActorDid(c.get("ctx"), handle);
    endTime(c, "resolveDid");

    if (!did) {
      return renderError(c, {
        status: 404,
        message: "User not found",
        description: "This user does not exist.",
        title: "User Not Found",
      });
    }

    const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
    startTime(c, "getList");
    const result = await getListWithItems({
      db: c.get("ctx").db,
      listUri,
    });
    endTime(c, "getList");

    if (!result) {
      return renderError(c, {
        status: 404,
        message: "Shelf not found",
        description: "This shelf does not exist or has been deleted.",
        title: "Shelf Not Found",
      });
    }

    const sessionAgent = await c.get("ctx").getSessionAgent();
    const isOwner = sessionAgent?.did === did;
    startTime(c, "getProfile");
    const profile = await getProfile({ ctx: c.get("ctx"), did });
    endTime(c, "getProfile");

    const searchQuery = isOwner ? c.req.query("q") || "" : "";
    let searchResults: HiveBook[] = [];
    if (searchQuery) {
      const ctx = c.get("ctx");
      startTime(c, "shelfSearch");
      // Was a `LIKE '%…%'` full scan that stalled the whole worker on every
      // keystroke; now shares the same query as the other search call sites.
      const [externalIds, localIds] = await Promise.all([
        searchBooks({ query: searchQuery, ctx }),
        searchLocalCatalog({ db: ctx.db, q: searchQuery, limit: 50 }),
      ]);

      // External hits first, then local-only, both in relevance order — preserved by `hydrateSearchResults`.
      const externalSet = new Set(externalIds);
      const ordered = [...externalIds, ...localIds.filter((id) => !externalSet.has(id))];
      searchResults = (await hydrateSearchResults({ db: ctx.db, ids: ordered })).slice(0, 20);
      endTime(c, "shelfSearch");
    }

    const existingHiveIds = new Set(result.items.map((i) => i.hiveId).filter(Boolean));
    const filteredSearchResults = searchResults.filter((b) => !existingHiveIds.has(b.id));

    return c.render(
      <ShelfViewPage
        list={result.list}
        items={result.items}
        handle={handle}
        isOwner={isOwner}
        profile={profile}
        searchQuery={searchQuery}
        searchResults={filteredSearchResults}
      />,
      {
        title: `BookHive | ${result.list.name}`,
        description:
          result.list.description || `${result.list.name} — a book shelf by @${handle} on BookHive`,
        atTags: { canonical: result.list.uri, author: result.list.userDid },
      },
    );
  })

  // Edit shelf form page
  .get("/:handle/:rkey/edit", async (c) => {
    const handle = c.req.param("handle");
    const rkey = c.req.param("rkey");
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.redirect("/login");
    }

    const did = await resolveActorDid(c.get("ctx"), handle);
    if (!did || did !== agent.did) {
      return renderError(c, {
        status: 403,
        message: "Not authorized",
        description: "You can only edit your own shelves.",
        title: "Not Authorized",
      });
    }

    const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
    startTime(c, "getList");
    const result = await getListWithItems({
      db: c.get("ctx").db,
      listUri,
    });
    endTime(c, "getList");

    if (!result) {
      return renderError(c, {
        status: 404,
        message: "Shelf not found",
        description: "This shelf does not exist.",
        title: "Shelf Not Found",
      });
    }

    return c.render(<ShelfEditPage list={result.list} handle={handle} />, {
      title: `BookHive | Edit ${result.list.name}`,
    });
  })

  // Update shelf handler
  .post(
    "/:handle/:rkey/edit",
    zValidator(
      "form",
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        ordered: z.string().optional(),
      }),
    ),
    async (c) => {
      const handle = c.req.param("handle");
      const rkey = c.req.param("rkey");
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.redirect("/login");
      }

      const did = await resolveActorDid(c.get("ctx"), handle);
      if (!did) {
        return c.redirect("/shelves/new");
      }

      const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
      const { name, description, ordered } = c.req.valid("form");
      try {
        startTime(c, "updateList");
        const updated = await updateList({
          agent,
          db: c.get("ctx").db,
          uri: listUri,
          name,
          description: description ?? undefined,
          ordered: ordered === "on",
        });
        endTime(c, "updateList");
        if (!updated.ok) return renderListFailure(c, updated);
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        c.set("requestError", e);
        return renderError(c, {
          status: 500,
          message: "Failed to update shelf",
          description: (e as Error).message,
          title: "Error",
        });
      }
    },
  )

  // Delete shelf handler
  .post("/:handle/:rkey/delete", async (c) => {
    const handle = c.req.param("handle");
    const rkey = c.req.param("rkey");
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.redirect("/login");
    }

    const did = await resolveActorDid(c.get("ctx"), handle);
    if (!did) {
      return c.redirect("/home");
    }

    const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
    try {
      startTime(c, "deleteList");
      const deleted = await deleteList({ agent, db: c.get("ctx").db, uri: listUri });
      endTime(c, "deleteList");
      if (!deleted.ok) return renderListFailure(c, deleted);
      return c.redirect(`/profile/${handle}`);
    } catch (e) {
      c.set("requestError", e);
      return renderError(c, {
        status: 500,
        message: "Failed to delete shelf",
        description: (e as Error).message,
        title: "Error",
      });
    }
  })

  // Add book to shelf handler (consolidated, from bookInfo page)
  .post(
    "/add",
    zValidator(
      "form",
      z.object({
        hiveId: z.string(),
        shelfPath: z.string(),
      }),
    ),
    async (c) => {
      const { hiveId, shelfPath } = c.req.valid("form");
      const [handle, rkey] = shelfPath.split("/");
      if (!handle || !rkey) {
        return c.json({ success: false, message: "Invalid shelf path" }, 400);
      }
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return jsonUnauthorized(c);
      }
      const did = await resolveActorDid(c.get("ctx"), handle);
      if (!did) {
        return c.json({ success: false, message: "User not found" }, 404);
      }
      const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
      try {
        startTime(c, "addBookToList");
        const added = await addBookToList({
          agent,
          db: c.get("ctx").db,
          listUri,
          hiveId: hiveId as HiveId,
        });
        endTime(c, "addBookToList");
        if (!added.ok) return renderListFailure(c, added);
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        c.set("requestError", e);
        return renderError(c, {
          status: 500,
          message: "Failed to add book",
          description: (e as Error).message,
          title: "Error",
        });
      }
    },
  )

  // Add book to shelf handler
  .post(
    "/:handle/:rkey/add",
    zValidator(
      "form",
      z.object({
        hiveId: z.string(),
        q: z.string().optional(),
      }),
    ),
    async (c) => {
      const handle = c.req.param("handle");
      const rkey = c.req.param("rkey");
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return jsonUnauthorized(c);
      }

      const did = await resolveActorDid(c.get("ctx"), handle);
      if (!did) {
        return c.json({ success: false, message: "User not found" }, 404);
      }

      const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
      const { hiveId, q } = c.req.valid("form");
      try {
        startTime(c, "addBookToList");
        const added = await addBookToList({
          agent,
          db: c.get("ctx").db,
          listUri,
          hiveId: hiveId as HiveId,
        });
        endTime(c, "addBookToList");
        if (!added.ok) return renderListFailure(c, added);
        const redirectUrl = q
          ? `/shelves/${handle}/${rkey}?q=${encodeURIComponent(q)}`
          : `/shelves/${handle}/${rkey}`;
        return c.redirect(redirectUrl);
      } catch (e) {
        c.set("requestError", e);
        return renderError(c, {
          status: 500,
          message: "Failed to add book",
          description: (e as Error).message,
          title: "Error",
        });
      }
    },
  )

  // Remove book from shelf handler
  .post(
    "/:handle/:rkey/remove",
    zValidator(
      "form",
      z.object({
        itemUri: z.string(),
        returnTo: z.string().optional(),
      }),
    ),
    async (c) => {
      const handle = c.req.param("handle");
      const rkey = c.req.param("rkey");
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return jsonUnauthorized(c);
      }

      const { itemUri, returnTo } = c.req.valid("form");
      try {
        startTime(c, "removeBookFromList");
        const removed = await removeBookFromList({
          agent,
          db: c.get("ctx").db,
          itemUri,
        });
        endTime(c, "removeBookFromList");
        if (!removed.ok) return renderListFailure(c, removed);
        const safeReturn = returnTo && returnTo.startsWith("/") ? returnTo : null;
        return c.redirect(safeReturn ?? `/shelves/${handle}/${rkey}`);
      } catch (e) {
        c.set("requestError", e);
        return renderError(c, {
          status: 500,
          message: "Failed to remove book",
          description: (e as Error).message,
          title: "Error",
        });
      }
    },
  );

import type { FC } from "hono/jsx";
import type { BookListRow, ProfileViewDetailed } from "../types";
import { BookCard, type BookCardData } from "../pages/components/BookCard";
import { hiveRatingToDisplayRating } from "../core/rating";
import { jsonUnauthorized } from "./authResponse";

type ShelfPreviewItem = {
  cover: string | null;
  thumbnail: string | null;
  embeddedCoverUrl: string | null;
  embeddedTitle: string | null;
  embeddedAuthor: string | null;
  hiveId: string | null;
  title: string | null;
  authors: string | null;
  rating: number | null;
};

const ShelvesListPage: FC<{
  handle: string;
  lists: Array<BookListRow & { itemCount: number | null }>;
  isOwnProfile: boolean;
  profile: ProfileViewDetailed | null;
  previewsByList: Map<string, ShelfPreviewItem[]>;
}> = ({ handle, lists, isOwnProfile, previewsByList }) => {
  return (
    <div class="space-y-6 px-4 lg:px-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-foreground">
            {isOwnProfile ? "My Shelves" : `@${handle}'s Shelves`}
          </h1>
          <p class="text-sm text-muted-foreground">
            {lists.length} {lists.length === 1 ? "shelf" : "shelves"}
          </p>
        </div>
        {isOwnProfile && (
          <a href="/shelves/new" class="btn btn-primary">
            New Shelf
          </a>
        )}
      </div>

      {lists.length === 0 ? (
        <div class="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <p class="text-lg text-muted-foreground">
            {isOwnProfile ? "You haven't created any shelves yet." : "No shelves to show."}
          </p>
          {isOwnProfile && (
            <a href="/shelves/new" class="btn btn-primary mt-4 inline-block">
              Create your first shelf
            </a>
          )}
        </div>
      ) : (
        <div class="flex flex-col gap-4">
          {lists.map((list) => {
            const rkey = list.uri.split("/").at(-1)!;
            return (
              <ShelfCard
                key={list.uri}
                name={list.name}
                description={list.description}
                itemCount={list.itemCount ?? 0}
                href={`/shelves/${handle}/${rkey}`}
                ordered={Boolean(list.ordered)}
                previewCovers={previewsByList.get(list.uri) ?? []}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export const ShelfCard: FC<{
  name: string;
  description: string | null;
  itemCount: number | null;
  href: string;
  ordered?: boolean;
  previewCovers?: ShelfPreviewItem[];
}> = ({ name, description, itemCount, href, ordered, previewCovers }) => {
  return (
    <div class="card flex flex-col gap-3 overflow-visible p-5">
      <a href={href} class="group flex items-start justify-between gap-2">
        <h3 class="text-lg font-semibold text-foreground group-hover:text-primary line-clamp-1">
          {name}
        </h3>
        {ordered && <span class="badge badge-sm shrink-0">Ranked</span>}
      </a>
      {description && <p class="text-sm text-muted-foreground line-clamp-2">{description}</p>}

      {previewCovers && previewCovers.length > 0 && (
        <div class="flex gap-3 overflow-visible">
          {previewCovers.map((item, i) => {
            const bookData: BookCardData = {
              hiveId: item.hiveId,
              title: item.title || item.embeddedTitle || "Unknown Book",
              authors: item.authors || item.embeddedAuthor || "Unknown Author",
              cover: item.cover || item.embeddedCoverUrl,
              thumbnail: item.thumbnail,
              rating: hiveRatingToDisplayRating(item.rating) ?? 0,
            };

            return (
              <div key={i} class="w-20 shrink-0">
                <BookCard variant="dense" book={bookData} />
              </div>
            );
          })}
        </div>
      )}

      <p class="mt-auto text-xs text-muted-foreground">
        {itemCount ?? 0} {(itemCount ?? 0) === 1 ? "book" : "books"}
      </p>
    </div>
  );
};

export default app;
