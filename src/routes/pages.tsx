/**
 * Static and listing pages: home, app, privacy, import, genres, authors.
 * Mount at / so paths are /, /app, /import, /genres, /genres/:genre, /authors/:author.
 */
import { Hono } from "hono";

import type { AppEnv } from "../context";
import { Error as ErrorPage } from "../pages/error";
import { Home } from "../pages/home";
import { AppPage } from "../pages/app";
import { Layout } from "../pages/layout";
import { LibraryImport } from "../pages/import";
import { PrivacyPolicy } from "../pages/privacy-policy";
import { GenresDirectory } from "../pages/genres";
import { GenreBooks, getBooksByGenre } from "../pages/genreBooks";
import { AuthorBooks, getBooksByAuthor } from "../pages/authorBooks";

const app = new Hono<AppEnv>()
  .get("/", async (c) => {
    const url = new URL(c.req.raw.url);
    if (url.searchParams.get("app") || url.hostname === "app.bookhive.buzz") {
      return c.redirect("/app");
    }
    return c.render(<Home />, { title: "BookHive | Home" });
  })
  .get("/.well-known/atproto-did", (c) =>
    c.text("did:plc:enu2j5xjlqsjaylv3du4myh4"),
  )
  .get("/app", (c) =>
    c.render(<AppPage />, {
      title: "BookHive App for iOS",
      description:
        "The BookHive iOS app lets you manage, organize, and review your books anywhere.",
      image: "/public/hive.jpg",
    }),
  )
  .get("/privacy-policy", (c) =>
    c.render(<PrivacyPolicy />, {
      title: "BookHive | Privacy Policy",
      description:
        "Learn how BookHive uses cookies for login and only processes public ATProto data.",
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
      description:
        "Import your library from Goodreads or StoryGraph to BookHive",
    });
  })
  .get("/genres", (c) =>
    c.render(<GenresDirectory />, {
      title: "BookHive | Explore Genres",
      description: "Explore books by genre on BookHive",
    }),
  )
  .get("/genres/:genre", async (c) => {
    const genre = decodeURIComponent(c.req.param("genre"));
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const sortBy =
      (c.req.query("sort") as "popularity" | "relevance" | "reviews") ||
      "popularity";
    const result = await getBooksByGenre(
      genre,
      c.get("ctx"),
      page,
      100,
      sortBy,
      c,
    );
    return c.render(
      <GenreBooks
        genre={genre}
        books={result.books}
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        totalBooks={result.totalBooks}
        sortBy={sortBy}
      />,
      {
        title: `BookHive | ${genre} Books`,
        description: `Discover ${result.totalBooks} ${genre} books on BookHive`,
      },
    );
  })
  .get("/authors/:author", async (c) => {
    const author = decodeURIComponent(c.req.param("author"));
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const sortBy =
      (c.req.query("sort") as "popularity" | "reviews") || "popularity";
    const result = await getBooksByAuthor(
      author,
      c.get("ctx"),
      page,
      100,
      sortBy,
      c,
    );
    return c.render(
      <AuthorBooks
        author={author}
        books={result.books}
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        totalBooks={result.totalBooks}
        sortBy={sortBy}
      />,
      {
        title: `BookHive | Books by ${author}`,
        description: `Discover ${result.totalBooks} books by ${author} on BookHive`,
      },
    );
  });

export default app;
