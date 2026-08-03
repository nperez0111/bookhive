import { html, raw } from "hono/html";

import { type FC, type PropsWithChildren } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";

import { BOOKHIVE_DID } from "../constants";
import { AtTags, type AtTagsProps } from "./components/AtTags";

type BundleAssetUrls = { css: string[]; js: string[]; inlineCss?: string } | null;

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
    /** AT Tags — ATProto records/identities this page corresponds to. */
    atTags?: AtTagsProps;
  }>
> = ({
  children,
  title = "Bookhive",
  // `/full_logo.png` does not exist — the file is `full_logo.jpg` (every other reference in the
  // codebase uses .jpg). The default og:image 404'd on every page that didn't pass its own.
  image = "/full_logo.jpg",
  description = "Goodreads but better. Built on top of Blue Sky.",
  assetUrls: assetUrlsProp,
  url: urlProp,
  ogType = "website",
  ogExtra,
  atTags,
}) => {
  // Resolve `url` and `assetUrls` independently. They used to share one branch that only ran when
  // `assetUrls` was undefined — but 15 of the 16 <Layout> call sites pass `assetUrls` and omit
  // `url`, so those pages never reached the context lookup and fell through to the hardcoded
  // origin. /privacy-policy and /legal were telling crawlers their canonical URL was the
  // homepage, which asks Google to drop them in favour of `/`.
  let url = urlProp;
  let assetUrls = assetUrlsProp;
  if (url === undefined || assetUrls === undefined) {
    try {
      const c = useRequestContext();
      url ??= c.req.url;
      assetUrls ??= c.get("assetUrls") ?? null;
    } catch {
      // Rendered outside a request (tests, OG worker) — fall back to the canonical origin.
    }
  }
  url ??= "https://bookhive.buzz";
  assetUrls ??= null;
  // og:image and twitter:image must be absolute — crawlers do not resolve them against the page.
  // Callers pass either a root-relative path ("/full_logo.jpg") or an already-absolute OG route.
  const absoluteImage = image.startsWith("http") ? image : new URL(image, url).toString();
  // Never put the raw request URL in crawler-facing metadata. `/oauth/callback` renders a Layout
  // on its invalid-redirect_uri branch (src/auth/router.tsx) with `url={c.req.url}`, so the
  // OAuth authorization `code` and `state` were being written straight into <link rel="canonical">,
  // og:url and twitter:url — a live credential in a tag built to be scraped, cached and shared.
  const metaUrl = (() => {
    try {
      const u = new URL(url);
      for (const k of ["code", "state", "redirect_uri", "iss", "error", "error_description"]) {
        u.searchParams.delete(k);
      }
      return u.toString();
    } catch {
      return url;
    }
  })();
  // The JSON-LD below describes the *site*, not this page. `url` is `c.req.url`, so building the
  // SearchAction target from it produced e.g. `/books/bk_abc/search?q={search_term_string}`.
  const origin = new URL(metaUrl).origin;

  // In dev mode, CSS is imported by the client entry, so we don't need a separate link tag
  const cssUrls = assetUrls?.css ?? ["/assets/style.css"];
  const jsUrls = assetUrls?.js ?? ["/assets/index.js"];
  // In production we inline the built CSS into <head> to avoid a render-blocking
  // stylesheet request. When present, skip the <link> tags entirely.
  const inlineCss = assetUrls?.inlineCss;
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
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            const dark = stored === "dark" || (!stored && prefersDark);
            document.documentElement.classList.toggle("dark", dark);
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute("content", dark ? "#422006" : "#f9eabc");
          })();
        </script>
        ${inlineCss
          ? html`<style>
              ${raw(inlineCss)}
            </style>`
          : cssUrls.map((href) => html`<link rel="stylesheet" href="${href}" />`)}
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
        ${!isDevVite && jsUrls.map((src) => html`<link rel="modulepreload" href="${src}" />`)}
        ${jsUrls.map((src) => html`<script type="module" src="${src}"></script>`)}
        <meta property="og:url" content="${metaUrl}" />
        <meta property="og:type" content="${ogType}" />
        <meta property="og:title" content="${title}" />
        <meta property="og:site_name" content="BookHive" />
        <meta property="og:description" content="${description}" />
        <meta property="og:image" content="${absoluteImage}" />
        <meta property="og:logo" content="${new URL("/icon.svg", url).toString()}" />
        ${ogExtra}
        <meta name="at:me" content="${`at://${BOOKHIVE_DID}`}" />
        ${AtTags(atTags ?? {})}
        <meta name="twitter:card" content="summary_large_image" />
        <meta property="twitter:domain" content="bookhive.buzz" />
        <meta property="twitter:url" content="${metaUrl}" />
        <meta name="twitter:title" content="${title}" />
        <meta name="twitter:description" content="${description}" />
        <meta name="twitter:image" content="${absoluteImage}" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="${description}" />
        <meta name="robots" content="index, follow" />
        <meta name="author" content="BookHive" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="canonical" href="${metaUrl}" />
        <title>${title}</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "BookHive",
            "description": "${description}",
            "url": "${origin}",
            "potentialAction": {
              "@type": "SearchAction",
              "target": "${origin}/search?q={search_term_string}",
              "query-input": "required name=search_term_string"
            },
            "publisher": {
              "@type": "Organization",
              "name": "BookHive",
              "url": "${origin}"
            }
          }
        </script>
        ${raw(`<script type="speculationrules">
          {
            "prefetch": [{
              "where": {
                "and": [
                  { "href_matches": "/*" },
                  { "not": { "href_matches": "/logout" } },
                  { "not": { "href_matches": "/login" } },
                  { "not": { "href_matches": "/api/*" } },
                  { "not": { "href_matches": "/images/*" } },
                  { "not": { "selector_matches": "[download]" } },
                  { "not": { "selector_matches": "[target=_blank]" } }
                ]
              },
              "eagerness": "moderate"
            }]
          }
        </script>`)}
      </head>
      <body class="bg-background text-foreground min-h-full">
        ${children}
      </body>
    </html>`;
};
