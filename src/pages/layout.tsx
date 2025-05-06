import { html, raw } from "hono/html";

import { type FC, type PropsWithChildren } from "hono/jsx";
import { readFileSync } from "node:fs";

import { env } from "../env";
import { useRequestContext } from "hono/jsx-renderer";

const cssFileContent = readFileSync("./public/output.css", "utf-8");

const now = Date.now();

export const Layout: FC<
  PropsWithChildren<{ title?: string; image?: string; description?: string }>
> = ({
  children,
  title = "Bookhive",
  image = "/public/full_logo.png",
  description = "Goodreads but better. Built on top of Blue Sky.",
}) => {
  let url: string;
  try {
    url = useRequestContext().req.url;
  } catch (e) {
    url = "https://bookhive.buzz";
  }
  return html`<!doctype html>
    <html lang="en" class="bg-sand h-full dark:bg-zinc-900 dark:text-white">
      <head>
        <meta charset="UTF-8" />
        <meta property="og:url" content="${url}" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="BookHive" />
        <meta property="og:description" content="${description}" />
        <meta property="og:image" content="${image}" />
        <meta property="og:logo" content="/public/icon.svg" />
        <meta name="twitter:card" content="${image}" />
        <meta property="twitter:domain" content="bookhive.buzz" />
        <meta property="twitter:url" content="${url}" />
        <meta name="twitter:title" content="${title}" />
        <meta name="twitter:description" content="${description}" />
        <meta name="twitter:image" content="${image}" />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/public/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/public/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/public/favicon-16x16.png"
        />
        <link rel="manifest" href="/public/site.webmanifest" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
        <style>
          ${
            // Inlining the CSS saves a network request
            raw(cssFileContent)
          }
        </style>
        ${env.isDevelopment
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
                      lastTime = time;
                    }
                  })
                  .catch(() => {
                    console.error("Failed to check time");
                  });

                setTimeout(checkTime, 1000);
              }
              checkTime();
            </script>`
          : ""}
        <script type="module" src="/public/js/client.js?v=${now}"></script>
      </head>
      <body>
        ${children}
      </body>
    </html>`;
};
