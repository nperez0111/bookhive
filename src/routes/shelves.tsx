/**
 * Book Shelves routes. Mount at /shelves.
 * Handles shelf CRUD via form submissions and SSR pages.
 */
import { zValidator } from "@hono/zod-validator";
import { isDid } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import { endTime, startTime } from "hono/timing";
import { z } from "zod";

import type { AppEnv } from "../context";
import { Error as ErrorPage } from "../pages/error";
import { Layout } from "../pages/layout";
import { ShelfViewPage, ShelfCreatePage, ShelfEditPage } from "../pages/shelves";
import {
  createList,
  updateList,
  deleteList,
  addBookToList,
  removeBookFromList,
  getUserLists,
  getListWithItems,
} from "../utils/lists";
import type { HiveBook, HiveId } from "../types";
import { getProfile } from "../utils/getProfile";
import { searchBooks } from "./lib";

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
        const { uri } = await createList({
          agent,
          db: c.get("ctx").db,
          name,
          description: description || undefined,
          ordered: ordered === "on",
        });
        const rkey = uri.split("/").at(-1)!;
        const handle = await c.get("ctx").resolver.resolveDidToHandle(agent.did);
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to create shelf"
              description={(e as Error).message}
              statusCode={500}
            />
          </Layout>,
          500,
        );
      }
    },
  )

  // View a user's shelves
  .get("/:handle", async (c) => {
    const handle = c.req.param("handle");
    startTime(c, "resolveDid");
    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    endTime(c, "resolveDid");

    if (!did) {
      return c.render(
        <ErrorPage
          message="User not found"
          description="This user does not exist."
          statusCode={404}
        />,
        { title: "User Not Found" },
      );
    }

    const lists = await getUserLists({ db: c.get("ctx").db, userDid: did });
    const profile = await getProfile({ ctx: c.get("ctx"), did });
    const sessionAgent = await c.get("ctx").getSessionAgent();

    // Fetch preview covers for each shelf
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
      for (const item of previewItems) {
        const arr = previewsByList.get(item.listUri) ?? [];
        if (arr.length < 10) arr.push(item);
        previewsByList.set(item.listUri, arr);
      }
    }

    // Redirect to profile if coming from there
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
    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    endTime(c, "resolveDid");

    if (!did) {
      return c.render(
        <ErrorPage
          message="User not found"
          description="This user does not exist."
          statusCode={404}
        />,
        { title: "User Not Found" },
      );
    }

    const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
    startTime(c, "getList");
    const result = await getListWithItems({
      db: c.get("ctx").db,
      listUri,
    });
    endTime(c, "getList");

    if (!result) {
      return c.render(
        <ErrorPage
          message="Shelf not found"
          description="This shelf does not exist or has been deleted."
          statusCode={404}
        />,
        { title: "Shelf Not Found" },
      );
    }

    const sessionAgent = await c.get("ctx").getSessionAgent();
    const isOwner = sessionAgent?.did === did;
    const profile = await getProfile({ ctx: c.get("ctx"), did });

    // If owner and searching, run book search
    const searchQuery = isOwner ? c.req.query("q") || "" : "";
    let searchResults: HiveBook[] = [];
    if (searchQuery) {
      const ctx = c.get("ctx");
      const pattern = `%${searchQuery}%`;
      const [externalIds, localBooks] = await Promise.all([
        searchBooks({ query: searchQuery, ctx }),
        ctx.db
          .selectFrom("hive_book")
          .selectAll()
          .where((eb) => eb.or([eb("title", "like", pattern), eb("authors", "like", pattern)]))
          .orderBy("ratingsCount", "desc")
          .limit(50)
          .execute(),
      ]);

      const externalIdSet = new Set(externalIds);
      const localOnly = localBooks.filter((b) => !externalIdSet.has(b.id));
      const externalBooks = externalIds.length
        ? await ctx.db.selectFrom("hive_book").selectAll().where("id", "in", externalIds).execute()
        : [];
      // Preserve external result order
      const externalMap = new Map(externalBooks.map((b) => [b.id, b]));
      const orderedExternal = externalIds
        .map((id) => externalMap.get(id))
        .filter(Boolean) as HiveBook[];
      searchResults = [...orderedExternal, ...localOnly].slice(0, 20);
    }

    // Filter out books already on the shelf
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

    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    if (!did || did !== agent.did) {
      return c.render(
        <ErrorPage
          message="Not authorized"
          description="You can only edit your own shelves."
          statusCode={403}
        />,
        { title: "Not Authorized" },
      );
    }

    const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
    const result = await getListWithItems({
      db: c.get("ctx").db,
      listUri,
    });

    if (!result) {
      return c.render(
        <ErrorPage
          message="Shelf not found"
          description="This shelf does not exist."
          statusCode={404}
        />,
        { title: "Shelf Not Found" },
      );
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

      const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
      if (!did) {
        return c.redirect("/shelves/new");
      }

      const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
      const { name, description, ordered } = c.req.valid("form");
      try {
        await updateList({
          agent,
          db: c.get("ctx").db,
          uri: listUri,
          name,
          description: description ?? undefined,
          ordered: ordered === "on",
        });
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to update shelf"
              description={(e as Error).message}
              statusCode={500}
            />
          </Layout>,
          500,
        );
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

    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    if (!did) {
      return c.redirect("/");
    }

    const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
    try {
      await deleteList({ agent, db: c.get("ctx").db, uri: listUri });
      return c.redirect(`/profile/${handle}`);
    } catch (e) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Failed to delete shelf"
            description={(e as Error).message}
            statusCode={500}
          />
        </Layout>,
        500,
      );
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
        return c.json({ success: false, message: "Not authenticated" }, 401);
      }
      const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
      if (!did) {
        return c.json({ success: false, message: "User not found" }, 404);
      }
      const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
      try {
        await addBookToList({
          agent,
          db: c.get("ctx").db,
          listUri,
          hiveId: hiveId as HiveId,
        });
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to add book"
              description={(e as Error).message}
              statusCode={500}
            />
          </Layout>,
          500,
        );
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
      }),
    ),
    async (c) => {
      const handle = c.req.param("handle");
      const rkey = c.req.param("rkey");
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json({ success: false, message: "Not authenticated" }, 401);
      }

      const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
      if (!did) {
        return c.json({ success: false, message: "User not found" }, 404);
      }

      const listUri = `at://${did}/social.popfeed.feed.list/${rkey}`;
      const { hiveId } = c.req.valid("form");
      try {
        await addBookToList({
          agent,
          db: c.get("ctx").db,
          listUri,
          hiveId: hiveId as HiveId,
        });
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to add book"
              description={(e as Error).message}
              statusCode={500}
            />
          </Layout>,
          500,
        );
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
      }),
    ),
    async (c) => {
      const handle = c.req.param("handle");
      const rkey = c.req.param("rkey");
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json({ success: false, message: "Not authenticated" }, 401);
      }

      const { itemUri } = c.req.valid("form");
      try {
        await removeBookFromList({
          agent,
          db: c.get("ctx").db,
          itemUri,
        });
        return c.redirect(`/shelves/${handle}/${rkey}`);
      } catch (e) {
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to remove book"
              description={(e as Error).message}
              statusCode={500}
            />
          </Layout>,
          500,
        );
      }
    },
  );

// Inline shelves list page component
import type { FC } from "hono/jsx";
import type { BookListRow, ProfileViewDetailed } from "../types";
import { FallbackCover } from "../pages/components/fallbackCover";
import { StarDisplay } from "../pages/components/cards/StarDisplay";

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
    <div class="card flex flex-col gap-3 p-5">
      {/* Shelf header — links to the shelf */}
      <a href={href} class="group flex items-start justify-between gap-2">
        <h3 class="text-lg font-semibold text-foreground group-hover:text-primary line-clamp-1">
          {name}
        </h3>
        {ordered && <span class="badge badge-sm shrink-0">Ranked</span>}
      </a>
      {description && <p class="text-sm text-muted-foreground line-clamp-2">{description}</p>}

      {/* Horizontal book strip */}
      {previewCovers && previewCovers.length > 0 && (
        <div class="flex gap-3 overflow-x-auto pb-1" style="scrollbar-width:none">
          {previewCovers.map((item, i) => {
            const src = item.cover || item.thumbnail || item.embeddedCoverUrl;
            const bookTitle = item.title || item.embeddedTitle || "Unknown Book";
            const bookAuthor = item.authors?.split("\t")[0] || item.embeddedAuthor || null;
            const bookRating = item.rating ? item.rating / 2000 : null;
            const bookHref = item.hiveId ? `/books/${item.hiveId}` : null;

            return (
              <div key={i} class="flex w-20 shrink-0 flex-col gap-1">
                {bookHref ? (
                  <a href={bookHref} class="shrink-0">
                    {src ? (
                      <img
                        src={src}
                        alt={bookTitle}
                        class="h-28 w-20 rounded object-cover shadow-sm"
                        loading="lazy"
                      />
                    ) : (
                      <FallbackCover className="h-28 w-20 rounded" />
                    )}
                  </a>
                ) : src ? (
                  <img
                    src={src}
                    alt={bookTitle}
                    class="h-28 w-20 rounded object-cover shadow-sm"
                    loading="lazy"
                  />
                ) : (
                  <FallbackCover className="h-28 w-20 rounded" />
                )}
                {bookHref ? (
                  <a
                    href={bookHref}
                    class="text-xs font-medium text-foreground hover:text-primary line-clamp-2 leading-tight"
                  >
                    {bookTitle}
                  </a>
                ) : (
                  <span class="text-xs font-medium text-foreground line-clamp-2 leading-tight">
                    {bookTitle}
                  </span>
                )}
                {bookAuthor && (
                  <p class="text-xs text-muted-foreground line-clamp-1 leading-tight">
                    {bookAuthor}
                  </p>
                )}
                {bookRating && bookRating > 0 && (
                  <StarDisplay rating={bookRating} size="sm" class="flex" />
                )}
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
