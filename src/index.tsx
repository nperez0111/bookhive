/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { FC } from "hono/jsx";
import { html, raw } from "hono/html";
import { prettyJSON } from "hono/pretty-json";

const app = new Hono();

app.use(prettyJSON());

const time = new Date().toISOString();
const cssFileContent = await Bun.file("./public/output.css").text();
export const Layout: FC<{ children: any }> = (props) =>
  html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta property="og:url" content="https://betterreads.nickthesick.com" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Better Reads" />
        <meta
          property="og:description"
          content="Goodreads but better. Built on top of Blue Sky."
        />
        <meta property="og:image" content="/public/preview.jpg" />
        <meta name="twitter:card" content="/public/preview.jpg" />
        <meta property="twitter:domain" content="betterreads.nickthesick.com" />
        <meta
          property="twitter:url"
          content="https://betterreads.nickthesick.com"
        />
        <meta name="twitter:title" content="Better Reads" />
        <meta
          name="twitter:description"
          content="Goodreads but better. Built on top of Blue Sky."
        />
        <meta name="twitter:image" content="/public/preview.jpg" />
        <link rel="icon" type="image/svg+xml" href="/public/icon.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Better Reads</title>
        <style>
          ${
            // Inlining the CSS saves a network request
            raw(cssFileContent)
          }
        </style>
        ${process.env.NODE_ENV === "development"
          ? // This feels like a hack, but it's a good way to get the page to reload only in development
            html`<script type="text/javascript">
              // Hot-reload the page when the server restarts
              let lastTime = 0;
              function checkTime() {
                fetch("/healthcheck")
                  .then((res) => res.text())
                  .then((time) => {
                    if (lastTime === 0) {
                      lastTime = time;
                    }
                    if (lastTime !== time) {
                      location.reload();
                    }
                  });

                setTimeout(checkTime, 1000);
              }
              checkTime();
            </script>`
          : ""}
      </head>
      <body>
        ${props["children"]}
      </body>
    </html>`;

app.get("/ping", (c) => c.text("pong"));

app.get("/healthcheck", (c) => c.text(time));

app.get("/", (c) => {
  return c.html(
    <Layout>
      <div>Better Reads</div>
    </Layout>,
  );
});

app.use(
  "/public/*",
  serveStatic({
    root: "./",
    rewriteRequestPath: (path) => path.replace(/^\/static/, "./public"),
    mimes: {
      css: "text/css",
      svg: "image/svg+xml",
      jpg: "image/jpeg",
      mp4: "video/mp4",
      woff2: "font/woff2",
    },
  }),
);

const PORT = parseInt(process.env["PORT"] ?? "2500", 10);

export default {
  fetch: app.fetch,
  port: PORT,
};
