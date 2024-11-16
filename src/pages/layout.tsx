/** @jsx createElement */
import { html, raw } from "hono/html";
// @ts-expect-error
import { type FC, createElement } from "hono/jsx";
import { readFileSync } from "node:fs";

import { env } from "../env";

const cssFileContent = readFileSync("./public/output.css", "utf-8");

export const Layout: FC<{ children: any }> = (props) =>
  html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta property="og:url" content="https://bookhive.buzz" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Book Hive" />
        <meta
          property="og:description"
          content="Goodreads but better. Built on top of Blue Sky."
        />
        <meta property="og:image" content="/public/preview.jpg" />
        <meta name="twitter:card" content="/public/preview.jpg" />
        <meta property="twitter:domain" content="bookhive.buzz" />
        <meta
          property="twitter:url"
          content="https://bookhive.buzz"
        />
        <meta name="twitter:title" content="Book Hive>
        <meta
          name="twitter:description"
          content="Goodreads but better. Built on top of Blue Sky."
        />
        <meta name="twitter:image" content="/public/preview.jpg" />
        <link rel="icon" type="image/svg+xml" href="/public/icon.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Book Hive</title>
        <style>
          ${
            // Inlining the CSS saves a network request
            raw(cssFileContent)
          }
        </style>
        ${
          env.isDevelopment
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
            : ""
        }
      </head>
      <body>
        ${props["children"]}
      </body>
    </html>`;
