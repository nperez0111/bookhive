import { html, raw } from "hono/html";

import { type FC, type PropsWithChildren } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";

type BundleAssetUrls = { css: string[]; js: string[] } | null;

export const Layout: FC<
  PropsWithChildren<{
    title?: string;
    image?: string;
    description?: string;
    /** Pass from jsxRenderer when available so Layout doesn't need RequestContext */
    assetUrls?: BundleAssetUrls;
    url?: string;
    ogType?: string;
    ogExtra?: any;
  }>
> = ({
  children,
  title = "Bookhive",
  image = "/public/full_logo.png",
  description = "Goodreads but better. Built on top of Blue Sky.",
  assetUrls: assetUrlsProp,
  url: urlProp,
  ogType = "website",
  ogExtra,
}) => {
  let url = urlProp ?? "https://bookhive.buzz";
  let assetUrls = assetUrlsProp;
  if (assetUrls === undefined) {
    try {
      const c = useRequestContext();
      url = c.req.url;
      assetUrls = c.get("assetUrls") ?? null;
    } catch {
      assetUrls = null;
    }
  }
  const cssUrls = assetUrls?.css?.length
    ? assetUrls.css
    : ["/public/output.css"];
  const jsUrls = assetUrls?.js?.length
    ? assetUrls.js
    : ["/public/js/client.js"];
  const now = Date.now();

  return html`<!doctype html>
    <html lang="en" class="bg-sand h-full dark:bg-zinc-900 dark:text-white">
      <head>
        <meta charset="UTF-8" />
        <meta property="og:url" content="${url}" />
        <meta property="og:type" content="${ogType}" />
        <meta property="og:title" content="${title}" />
        <meta property="og:site_name" content="BookHive" />
        <meta property="og:description" content="${description}" />
        <meta property="og:image" content="${image}" />
        <meta property="og:logo" content="/public/icon.svg" />
        ${ogExtra}
        <meta name="twitter:card" content="summary_large_image" />
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
        ${cssUrls.map((href) => html`<link rel="stylesheet" href="${href}" />`)}
        <style>
          ${raw(`/* Actor Typeahead theme variables - light mode (default) */
          actor-typeahead {
            --color-background: #ffffff;
            --color-border: #d1d5db;
            --color-shadow: #000000;
            --color-hover: #f3f4f6;
            --color-avatar-fallback: #e5e7eb;
            --radius: 8px;
            --padding-menu: 4px;
          }

          @media (prefers-color-scheme: dark) {
            actor-typeahead {
              --color-background: #27272a;
              --color-border: #3f3f46;
              --color-shadow: #000000;
              --color-hover: #3f3f46;
              --color-avatar-fallback: #52525b;
            }
          }

          @media (prefers-color-scheme: light) {
            actor-typeahead {
              --color-background: #ffffff;
              --color-border: #d1d5db;
              --color-shadow: #000000;
              --color-hover: #f3f4f6;
              --color-avatar-fallback: #e5e7eb;
            }
          }

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
          }`)}
        </style>
        ${jsUrls.map(
          (src) => html`<script type="module" src="${src}"></script>`,
        )}
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
