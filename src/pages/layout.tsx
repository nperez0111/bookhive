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
  image = "/full_logo.png",
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
  // In dev mode, CSS is imported by the client entry, so we don't need a separate link tag
  const cssUrls = assetUrls?.css ?? ["/assets/style.css"];
  const jsUrls = assetUrls?.js ?? ["/assets/index.js"];
  // When running behind Vite dev, assetUrls.js contains /src/ paths; plugin replaces this marker with Vite client
  const isDevVite = assetUrls?.js?.some((s) => s.startsWith("/src/")) ?? false;

  return html`<!doctype html>
    <html lang="en" class="bg-background text-foreground h-full">
      <head>
        ${isDevVite ? raw("<!-- INJECT_VITE_DEV -->") : ""}
        <meta charset="UTF-8" />
        <meta name="theme-color" content="#f9eabc" />
        <script>
          (function () {
            const stored = localStorage.getItem("theme");
            const prefersDark = window.matchMedia(
              "(prefers-color-scheme: dark)",
            ).matches;
            const dark = stored === "dark" || (!stored && prefersDark);
            document.documentElement.classList.toggle("dark", dark);
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta)
              meta.setAttribute("content", dark ? "#422006" : "#f9eabc");
          })();
        </script>
        <meta property="og:url" content="${url}" />
        <meta property="og:type" content="${ogType}" />
        <meta property="og:title" content="${title}" />
        <meta property="og:site_name" content="BookHive" />
        <meta property="og:description" content="${description}" />
        <meta property="og:image" content="${image}" />
        <meta property="og:logo" content="/icon.svg" />
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
          href="/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon-16x16.png"
        />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="${description}" />
        <meta name="robots" content="index, follow" />
        <meta name="author" content="BookHive" />
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
          ${raw(`/* Actor Typeahead - uses theme tokens so it follows light/dark toggle */
          actor-typeahead {
            --color-background: var(--card);
            --color-border: var(--border);
            --color-shadow: #000000;
            --color-hover: var(--muted);
            --color-avatar-fallback: var(--muted);
            --radius: 8px;
            --padding-menu: 4px;
          }`)}
        </style>
        ${jsUrls.map((src) => html`<script type="module" src="${src}"></script>`)}
        <script type="module" src="/js/actor-typeahead.js"></script>
      </head>
      <body class="bg-background text-foreground min-h-full">
        ${children}
      </body>
    </html>`;
};
