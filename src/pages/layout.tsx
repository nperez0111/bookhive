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
        <meta property="og:title" content="${title}" />
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
        <meta name="description" content="${description}" />
        <meta name="robots" content="index, follow" />
        <meta name="author" content="BookHive" />
        <meta name="theme-color" content="#030712" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <link rel="canonical" href="${url}" />
        <title>${title}</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "BookHive",
            "description": "${description}",
            "url": "${url}",
            "potentialAction": {
              "@type": "SearchAction",
              "target": "${url}/search?q={search_term_string}",
              "query-input": "required name=search_term_string"
            },
            "publisher": {
              "@type": "Organization",
              "name": "BookHive",
              "url": "https://bookhive.buzz"
            }
          }
        </script>
        <style>
          ${
            // Inlining the CSS saves a network request
            raw(cssFileContent)
          }
          
          /* Actor Typeahead theme variables - light mode (default) */
          actor-typeahead {
            --color-background: #ffffff;
            --color-border: #d1d5db;
            --color-shadow: #000000;
            --color-hover: #f3f4f6;
            --color-avatar-fallback: #e5e7eb;
            --radius: 8px;
            --padding-menu: 4px;
          }

          /* Actor Typeahead theme variables for dark mode (media query) */
          @media (prefers-color-scheme: dark) {
            actor-typeahead {
              --color-background: #27272a;
              --color-border: #3f3f46;
              --color-shadow: #000000;
              --color-hover: #3f3f46;
              --color-avatar-fallback: #52525b;
            }
          }

          /* Actor Typeahead theme variables for light mode (media query override) */
          @media (prefers-color-scheme: light) {
            actor-typeahead {
              --color-background: #ffffff;
              --color-border: #d1d5db;
              --color-shadow: #000000;
              --color-hover: #f3f4f6;
              --color-avatar-fallback: #e5e7eb;
            }
          }

          /* Optional: Class-based overrides (takes precedence over media queries) */
          html.dark actor-typeahead,
          .dark actor-typeahead {
            --color-background: #27272a;
            --color-border: #3f3f46;
            --color-shadow: #000000;
            --color-hover: #3f3f46;
            --color-avatar-fallback: #52525b;
          }

          html.light actor-typeahead,
          .light actor-typeahead {
            --color-background: #ffffff;
            --color-border: #d1d5db;
            --color-shadow: #000000;
            --color-hover: #f3f4f6;
            --color-avatar-fallback: #e5e7eb;
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
        <script
          type="module"
          src="/public/js/actor-typeahead.js?v=${now}"
        ></script>
      </head>
      <body>
        ${children}
      </body>
    </html>`;
};
