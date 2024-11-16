/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { FC } from "hono/jsx";
import { html, raw } from "hono/html";
import { prettyJSON } from "hono/pretty-json";

const app = new Hono();

app.use(prettyJSON());


app.get("/ping", (c) => c.text("pong"));

app.get("/healthcheck", (c) => c.text(time));

app.get("/", (c) => {
  return c.html(
    <Layout>
      <div>Book Hiveiv>
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
