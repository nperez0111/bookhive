/**
 * Static and listing pages: home, app, privacy, import, explore, genres, authors.
 * Mount at / so paths are /, /app, /import, /explore, /explore/genres, /explore/genres/:genre,
 * /explore/authors, /authors/:author.
 */
import { Hono } from "hono";
import { startTime, endTime } from "hono/timing";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { AppEnv } from "../context";
import { BOOKHIVE_DID } from "../constants";
import { Error as ErrorPage } from "../pages/error";
import { MyBooks } from "../pages/myBooks";
import { listAllUserBooks } from "../data/userShelves";
import { Home } from "../pages/home";
import { FeedPage } from "../pages/feed";
import { AppPage } from "../pages/app";
import { Layout } from "../pages/layout";
import { SimpleNavbar } from "../pages/simple-navbar";
import { LibraryImport } from "../pages/import";
import { Explore } from "../pages/explore";
import { GenresDirectory } from "../pages/genres";
import { GenreBooks } from "../pages/genreBooks";
import { AuthorDirectory } from "../pages/authorDirectory";
import { AuthorBooks } from "../pages/authorBooks";
import { SearchResults } from "../pages/searchResults";
import { cacheControl } from "./lib";
import { searchBooks } from "../services/searchBooks";
import { NO_STORE } from "../core/cacheHeaders";
import { getAvailableLanguages, resolveLanguage } from "../data/getLanguages";
import { feedQuerySchema, getActivityFeed } from "../data/activityFeed";
import { calculatePagination } from "../lib/pagination";
import { hydrateSearchResults, listBooksByAuthor, listBooksByGenre } from "../data/catalogBooks";

/**
 * `?page=` and `?sort=` for the two paginated catalogue pages. `?lang=` is not
 * here because it's validated against the catalogue itself (`resolveLanguage`),
 * which a schema cannot do.
 */
const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  sort: z.string().optional(),
});

const app = new Hono<AppEnv>()
  .get("/my-books", zValidator("query", z.object({})), async (c) => {
    c.header("Cache-Control", NO_STORE);
    const ctx = c.get("ctx");
    const profile = await ctx.getProfile();
    if (!profile) return c.redirect("/login", 302);
    const books = await listAllUserBooks({ db: ctx.db, userDid: profile.did });
    return c.render(<MyBooks books={books} handle={profile.handle} />, {
      title: "BookHive | My Books",
    });
  })
  .get("/home", async (c) => {
    // Personalized: never stored, not even for revalidation — `no-cache` would
    // still let the browser write the page to disk, letting a previous
    // account's /home survive a switch.
    c.header("Cache-Control", NO_STORE);
    const profile = await c.get("ctx").getProfile();
    if (!profile) {
      return c.redirect("/login", 302);
    }
    return c.render(<Home />, { title: "BookHive | Home" });
  })
  .get("/feed", zValidator("query", feedQuerySchema), async (c) => {
    // Fully personalized (friends/tracking tabs are follow-graph specific) —
    // same exposure as /home above.
    c.header("Cache-Control", NO_STORE);
    const profile = await c.get("ctx").getProfile();
    if (!profile) {
      return c.redirect("/login", 302);
    }
    const { tab, cursor } = c.req.valid("query");

    startTime(c, "db_feed");
    const feed = await getActivityFeed({
      ctx: c.get("ctx"),
      viewerDid: profile.did,
      tab,
      cursor,
    });
    endTime(c, "db_feed");
    if (!feed.ok) {
      return c.redirect("/login", 302);
    }

    return c.render(
      <FeedPage
        groups={feed.groups}
        currentTab={tab}
        nextCursor={feed.nextCursor}
        profileByDid={feed.profileByDid}
        didHandleMap={feed.didHandleMap}
        currentUserHandle={profile.handle}
      />,
      { title: "BookHive | Activity Feed" },
    );
  })
  .get("/.well-known/atproto-did", (c) => {
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.text(BOOKHIVE_DID);
  })
  .get("/app", (c) => {
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.html(
      <Layout
        assetUrls={c.get("assetUrls")}
        url={c.req.url}
        title="BookHive App for iOS"
        description="The BookHive iOS app lets you manage, organize, and review your books anywhere."
        image="/og/app"
      >
        <SimpleNavbar isPds={false} />
        <div class="mx-auto max-w-5xl px-4 py-12">
          <AppPage />
        </div>
      </Layout>,
    );
  })
  .get("/import", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      c.status(401);
      return c.render(
        <ErrorPage
          message="Invalid Session"
          description="Login to view your profile"
          statusCode={401}
        />,
        { title: "Unauthorized" },
      );
    }
    return c.render(<LibraryImport />, {
      title: "BookHive | Import",
      description: "Import your library from Goodreads, StoryGraph, or Hardcover to BookHive",
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
        lang: z.string().optional().default(""),
      }),
    ),
    async (c) => {
      const { q: query, page, lang: langParam } = c.req.valid("query");
      const lang = langParam || undefined;
      const pageSize = 100;
      const ctx = c.get("ctx");
      const { db, kv } = ctx;

      if (!query) {
        const languages = await getAvailableLanguages(db, kv);
        return c.render(
          <SearchResults
            query=""
            books={[]}
            currentPage={1}
            totalPages={0}
            totalBooks={0}
            pageSize={pageSize}
            lang={lang}
            languages={languages}
          />,
          {
            title: "BookHive | Search",
            description: "Search for books on BookHive",
          },
        );
      }

      // Get search results (cached external + local backfill IDs)
      startTime(c, "search_parallel");
      const [searchIds, languages] = await Promise.all([
        searchBooks({ query, ctx }),
        getAvailableLanguages(db, kv),
      ]);
      endTime(c, "search_parallel");

      startTime(c, "search_db_external");
      const allBooks = await hydrateSearchResults({ db, ids: searchIds, language: lang });
      endTime(c, "search_db_external");
      const totalBooks = allBooks.length;
      const { totalPages, offset, validPage } = calculatePagination(totalBooks, pageSize, page);
      const books = allBooks.slice(offset, offset + pageSize);

      return c.render(
        <SearchResults
          query={query}
          books={books}
          currentPage={validPage}
          totalPages={totalPages}
          totalBooks={totalBooks}
          pageSize={pageSize}
          lang={lang}
          languages={languages}
        />,
        {
          title: `BookHive | Search: ${query}`,
          description: `Search results for "${query}" on BookHive`,
        },
      );
    },
  )
  // Explore & author pages — publicly cacheable
  .use("/explore", cacheControl("public, max-age=3600, stale-while-revalidate=600"))
  .use("/explore/*", cacheControl("public, max-age=3600, stale-while-revalidate=600"))
  .use("/authors/*", cacheControl("public, max-age=3600, stale-while-revalidate=600"))
  .get("/explore", async (c) => {
    const { db, kv } = c.get("ctx");
    // Validated, not passed through: `lang` keys a cached aggregate, so an
    // arbitrary string is an unbounded KV-cardinality and CPU amplifier.
    const [lang, languages] = await Promise.all([
      resolveLanguage(db, kv, c.req.query("lang")),
      getAvailableLanguages(db, kv),
    ]);
    return c.render(<Explore lang={lang} languages={languages} />, {
      title: "BookHive | Discover",
      description: "Discover books by genre or author on BookHive",
    });
  })
  // Explore sub-pages
  .get("/explore/genres", async (c) => {
    // Validated, never passed through, same as /explore and /explore/authors:
    // it's in the anon page cache's ALLOWED_QUERY_PARAMS, so an arbitrary
    // string is an unbounded KV-cardinality amplifier.
    const { db, kv } = c.get("ctx");
    const lang = await resolveLanguage(db, kv, c.req.query("lang"));
    return c.render(<GenresDirectory lang={lang} />, {
      title: "BookHive | Explore Genres",
      description: "Explore books by genre on BookHive",
    });
  })
  .get("/explore/genres/:genre", zValidator("query", catalogQuerySchema), async (c) => {
    const genre = decodeURIComponent(c.req.param("genre"));
    const { page, sort } = c.req.valid("query");
    const sortBy = sort === "relevance" || sort === "reviews" ? sort : "popularity";
    const pageSize = 100;
    const { db, kv } = c.get("ctx");
    // Same rule as `/explore` and its siblings: `lang` is validated, never
    // passed through — it's an unbounded KV-cardinality amplifier otherwise,
    // and it reaches the SQL's `CASE WHEN language = ?`.
    const [lang, languages] = await Promise.all([
      resolveLanguage(db, kv, c.req.query("lang")),
      getAvailableLanguages(db, kv),
    ]);
    startTime(c, "genre_books");
    const result = await listBooksByGenre({
      db,
      genre,
      page,
      pageSize,
      sort: sortBy,
      language: lang,
    });
    endTime(c, "genre_books");
    return c.render(
      <GenreBooks
        genre={genre}
        books={result.books}
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        totalBooks={result.totalBooks}
        sortBy={sortBy}
        pageSize={pageSize}
        lang={lang}
        languages={languages}
      />,
      {
        title: `BookHive | ${genre} Books`,
        description: `Discover ${result.totalBooks} ${genre} books on BookHive`,
        image: `${new URL(c.req.url).origin}/og/genre/${encodeURIComponent(genre)}`,
      },
    );
  })
  .get("/explore/authors", async (c) => {
    const { db, kv } = c.get("ctx");
    // Same rule as /explore: `lang` must be validated here too, or every
    // language a crawler finds becomes its own anon-page-cache entry holding
    // byte-identical HTML.
    const [lang, languages] = await Promise.all([
      resolveLanguage(db, kv, c.req.query("lang")),
      getAvailableLanguages(db, kv),
    ]);
    return c.render(<AuthorDirectory lang={lang} languages={languages} />, {
      title: "BookHive | Explore Authors",
      description: "Explore books by author on BookHive",
    });
  })
  // Legacy redirects
  .get("/genres", (c) => c.redirect("/explore/genres", 301))
  .get("/genres/:genre", (c) =>
    c.redirect(
      `/explore/genres/${c.req.param("genre")}${c.req.url.includes("?") ? "?" + new URL(c.req.url).searchParams.toString() : ""}`,
      301,
    ),
  )
  .get("/authors/:author", zValidator("query", catalogQuerySchema), async (c) => {
    const author = decodeURIComponent(c.req.param("author"));
    const { page, sort } = c.req.valid("query");
    const sortBy = sort === "reviews" ? sort : "popularity";
    const pageSize = 100;
    const { db, kv } = c.get("ctx");
    // See the note on /explore/genres/:genre — `lang` is validated, never
    // passed through.
    const [lang, languages] = await Promise.all([
      resolveLanguage(db, kv, c.req.query("lang")),
      getAvailableLanguages(db, kv),
    ]);
    startTime(c, "author_books");
    const result = await listBooksByAuthor({
      db,
      author,
      page,
      pageSize,
      sort: sortBy,
      language: lang,
    });
    endTime(c, "author_books");
    return c.render(
      <AuthorBooks
        author={author}
        books={result.books}
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        totalBooks={result.totalBooks}
        sortBy={sortBy}
        pageSize={pageSize}
        lang={lang}
        languages={languages}
      />,
      {
        title: `BookHive | Books by ${author}`,
        description: `Discover ${result.totalBooks} books by ${author} on BookHive`,
        image: `${new URL(c.req.url).origin}/og/author/${encodeURIComponent(author)}`,
      },
    );
  });

export default app;
