/**
 * Static and listing pages: home, app, privacy, import, explore, genres, authors.
 * Mount at / so paths are /, /app, /import, /explore, /explore/genres, /explore/genres/:genre,
 * /explore/authors, /authors/:author.
 */
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { AppEnv } from "../context";
import { BookFields } from "../db";
import { Error as ErrorPage } from "../pages/error";
import { Home } from "../pages/home";
import { FeedPage } from "../pages/feed";
import { AppPage } from "../pages/app";
import { Layout } from "../pages/layout";
import { getProfiles } from "../utils/getProfile";
import { LibraryImport } from "../pages/import";
import { Explore } from "../pages/explore";
import { GenresDirectory } from "../pages/genres";
import { GenreBooks, getBooksByGenre } from "../pages/genreBooks";
import { AuthorDirectory } from "../pages/authorDirectory";
import { AuthorBooks, getBooksByAuthor } from "../pages/authorBooks";
import { SearchResults } from "../pages/searchResults";
import { searchBooks } from "./lib";

const app = new Hono<AppEnv>()
  .get("/", async (c) => {
    const url = new URL(c.req.raw.url);
    if (url.searchParams.get("app") || url.hostname === "app.bookhive.buzz") {
      return c.redirect("/app");
    }
    return c.render(<Home />, { title: "BookHive | Home" });
  })
  .get("/feed", async (c) => {
    const profile = await c.get("ctx").getProfile();
    if (!profile) {
      return c.redirect("/login", 302);
    }
    const ctx = c.get("ctx");
    const tab = (c.req.query("tab") as "friends" | "all" | "tracking") || "friends";
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = 25;
    const offset = (page - 1) * limit;

    let query = ctx.db
      .selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(BookFields)
      .orderBy("user_book.createdAt", "desc")
      .limit(limit + 1)
      .offset(offset);

    if (tab === "friends") {
      query = query.where(
        "user_book.userDid",
        "in",
        ctx.db
          .selectFrom("user_follows")
          .where("user_follows.userDid", "=", profile.did)
          .where("user_follows.isActive", "=", 1)
          .select("user_follows.followsDid"),
      ) as typeof query;
    } else if (tab === "tracking") {
      query = query.where(
        "user_book.hiveId",
        "in",
        ctx.db
          .selectFrom("user_book as ub2")
          .where("ub2.userDid", "=", profile.did)
          .select("ub2.hiveId"),
      ) as typeof query;
    }

    const rows = await query.execute();
    const hasMore = rows.length > limit;
    const activities = rows.slice(0, limit);

    const allDids = [...new Set(activities.map((a) => a.userDid))];
    const [didHandleMap, profiles] = await Promise.all([
      ctx.resolver.resolveDidsToHandles(allDids),
      allDids.length > 0 ? getProfiles({ ctx, dids: allDids }) : [],
    ]);
    const profileByDid = Object.fromEntries(profiles.map((p) => [p.did, p]));

    return c.render(
      <FeedPage
        activities={activities}
        currentTab={tab}
        currentPage={page}
        hasMore={hasMore}
        profileByDid={profileByDid}
        didHandleMap={didHandleMap}
      />,
      { title: "BookHive | Activity Feed" },
    );
  })
  .get("/.well-known/atproto-did", (c) => c.text("did:plc:enu2j5xjlqsjaylv3du4myh4"))
  .get("/app", (c) =>
    c.render(<AppPage />, {
      title: "BookHive App for iOS",
      description:
        "The BookHive iOS app lets you manage, organize, and review your books anywhere.",
      image: "/hive.jpg",
    }),
  )
  .get("/import", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to view your profile"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }
    return c.render(<LibraryImport />, {
      title: "BookHive | Import",
      description: "Import your library from Goodreads or StoryGraph to BookHive",
    });
  })
  // Search results page
  .get(
    "/search",
    zValidator(
      "query",
      z.object({
        q: z.string().optional().default(""),
        page: z.coerce.number().int().min(1).catch(1),
      }),
    ),
    async (c) => {
      const { q: query, page } = c.req.valid("query");
      const pageSize = 100;

      if (!query) {
        return c.render(
          <SearchResults
            query=""
            books={[]}
            currentPage={1}
            totalPages={0}
            totalBooks={0}
            pageSize={pageSize}
          />,
          {
            title: "BookHive | Search",
            description: "Search for books on BookHive",
          },
        );
      }

      const ctx = c.get("ctx");

      // Run external search (cached) and local DB text search in parallel
      const pattern = `%${query}%`;
      const [externalIds, localBooks] = await Promise.all([
        searchBooks({ query, ctx }),
        ctx.db
          .selectFrom("hive_book")
          .selectAll()
          .where((eb) =>
            eb.or([
              eb("rawTitle", "like", pattern),
              eb("title", "like", pattern),
              eb("authors", "like", pattern),
            ]),
          )
          .orderBy("ratingsCount", "desc")
          .limit(500)
          .execute(),
      ]);

      // Merge: external results first (relevance-ranked), then local DB hits not already included
      const externalIdSet = new Set(externalIds);
      const localOnly = localBooks.filter((b) => !externalIdSet.has(b.id));

      const externalBooks = externalIds.length
        ? await ctx.db
            .selectFrom("hive_book")
            .selectAll()
            .where("id", "in", externalIds)
            .execute()
            .then((rows) => {
              rows.sort((a, b) => externalIds.indexOf(a.id) - externalIds.indexOf(b.id));
              return rows;
            })
        : [];

      const allBooks = [...externalBooks, ...localOnly];
      const totalBooks = allBooks.length;
      const totalPages = Math.ceil(totalBooks / pageSize);
      const offset = (page - 1) * pageSize;
      const books = allBooks.slice(offset, offset + pageSize);

      return c.render(
        <SearchResults
          query={query}
          books={books}
          currentPage={page}
          totalPages={totalPages}
          totalBooks={totalBooks}
          pageSize={pageSize}
        />,
        {
          title: `BookHive | Search: ${query}`,
          description: `Search results for "${query}" on BookHive`,
        },
      );
    },
  )
  // Explore hub
  .get("/explore", (c) =>
    c.render(<Explore />, {
      title: "BookHive | Explore",
      description: "Discover books by genre or author on BookHive",
    }),
  )
  // Explore sub-pages
  .get("/explore/genres", (c) =>
    c.render(<GenresDirectory />, {
      title: "BookHive | Explore Genres",
      description: "Explore books by genre on BookHive",
    }),
  )
  .get("/explore/genres/:genre", async (c) => {
    const genre = decodeURIComponent(c.req.param("genre"));
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const sortBy = (c.req.query("sort") as "popularity" | "relevance" | "reviews") || "popularity";
    const pageSize = 100;
    const result = await getBooksByGenre(genre, c.get("ctx"), page, pageSize, sortBy, c);
    return c.render(
      <GenreBooks
        genre={genre}
        books={result.books}
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        totalBooks={result.totalBooks}
        sortBy={sortBy}
        pageSize={pageSize}
      />,
      {
        title: `BookHive | ${genre} Books`,
        description: `Discover ${result.totalBooks} ${genre} books on BookHive`,
      },
    );
  })
  .get("/explore/authors", (c) =>
    c.render(<AuthorDirectory />, {
      title: "BookHive | Explore Authors",
      description: "Explore books by author on BookHive",
    }),
  )
  // Legacy redirects
  .get("/genres", (c) => c.redirect("/explore/genres", 301))
  .get("/genres/:genre", (c) =>
    c.redirect(
      `/explore/genres/${c.req.param("genre")}${c.req.url.includes("?") ? "?" + new URL(c.req.url).searchParams.toString() : ""}`,
      301,
    ),
  )
  .get("/authors/:author", async (c) => {
    const author = decodeURIComponent(c.req.param("author"));
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const sortBy = (c.req.query("sort") as "popularity" | "reviews") || "popularity";
    const pageSize = 100;
    const result = await getBooksByAuthor(author, c.get("ctx"), page, pageSize, sortBy, c);
    return c.render(
      <AuthorBooks
        author={author}
        books={result.books}
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        totalBooks={result.totalBooks}
        sortBy={sortBy}
        pageSize={pageSize}
      />,
      {
        title: `BookHive | Books by ${author}`,
        description: `Discover ${result.totalBooks} books by ${author} on BookHive`,
      },
    );
  });

export default app;
