import type { IncomingMessage } from "node:http";
import { type Plugin, type ViteDevServer } from "vite";

const VITE_DEV_MARKER = "<!-- INJECT_VITE_DEV -->";
const VITE_CLIENT_SCRIPT =
  '<script type="module" src="/@vite/client"></script>';

/** Extensions that Vite serves as static/assets; paths ending with these are not proxied. */
const STATIC_EXTENSIONS = new Set([
  "css",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "json",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "map",
]);

/**
 * True when Vite should handle the request (don't proxy to Bun).
 * Proxy-by-default: we only skip Vite-owned paths and paths that look like static files.
 */
function shouldSkipProxy(req: IncomingMessage): boolean {
  if (!req.url) return true;
  const pathname = req.url.replace(/\?.*/, "");

  // Vite internals: client, HMR, @id/, etc.
  if (req.url.startsWith("/@")) return true;
  if (req.url.includes("/node_modules/")) return true;

  // /images/* is served by Bun (IPX), so never skip by extension
  if (pathname.startsWith("/images")) return false;

  // Only skip when the last path segment has a known static file extension
  // (so /profile/bookhive.buzz and /books/foo are proxied, /assets/style.css is not)
  const lastSegment = pathname.split("/").pop() ?? "";
  const ext = lastSegment.includes(".") ? lastSegment.split(".").pop()?.toLowerCase() : "";
  if (ext && STATIC_EXTENSIONS.has(ext)) return true;

  return false;
}

/**
 * Replace Layout's dev marker with Vite client script.
 * Fallback: if marker is absent (e.g. legacy or different entry), inject before </head>.
 */
function transformHtmlForDev(html: string): string {
  if (html.includes(VITE_DEV_MARKER)) {
    return html.replace(VITE_DEV_MARKER, VITE_CLIENT_SCRIPT);
  }
  // Fallback when marker is missing
  if (!html.includes("/@vite/client")) {
    return html.replace("</head>", `${VITE_CLIENT_SCRIPT}\n</head>`);
  }
  return html;
}

/**
 * SSR transform plugin for development mode.
 *
 * Proxies requests from Vite (5173) to Bun server (8080) by default,
 * skipping only Vite-owned paths (/@, node_modules, static file lookalikes).
 * For HTML responses, injects Vite client for HMR via a marker comment
 * emitted by Layout in dev.
 *
 * This allows dev mode to run Vite and Bun in parallel, with
 * Vite handling CSS/JS and Bun handling server rendering.
 */
export function ssrHtmlTransform(): Plugin {
  return {
    name: "ssr-html-transform",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (shouldSkipProxy(req)) return next();

        try {
          // Collect request body for POST/PUT/PATCH so we can forward it
          const hasBody =
            req.method === "POST" ||
            req.method === "PUT" ||
            req.method === "PATCH";
          let body: Buffer | undefined;
          if (hasBody && req.headers["content-length"]) {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.from(chunk));
            }
            body = Buffer.concat(chunks);
          }

          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            headers[name] = Array.isArray(value) ? value.join(", ") : value;
          }
          headers["host"] = "localhost:8080";

          const bunRes = await fetch(`http://localhost:8080${req.url}`, {
            method: req.method,
            headers,
            body,
            redirect: "manual",
          });

          // Forward redirects so the browser goes to OAuth (or callback target)
          if (bunRes.status >= 300 && bunRes.status < 400) {
            const location = bunRes.headers.get("location");
            if (location) {
              res.statusCode = bunRes.status;
              res.setHeader("Location", location);
              const setCookies =
                typeof bunRes.headers.getSetCookie === "function"
                  ? bunRes.headers.getSetCookie()
                  : (() => {
                      const c = bunRes.headers.get("set-cookie");
                      return c ? [c] : [];
                    })();
              for (const cookie of setCookies) {
                res.appendHeader("Set-Cookie", cookie);
              }
              bunRes.body?.cancel?.();
              res.end();
              return;
            }
          }

          const contentType = bunRes.headers.get("content-type") ?? "";
          const isHtml = contentType.includes("text/html");

          if (!isHtml) {
            res.statusCode = bunRes.status;
            bunRes.headers.forEach((value, key) => {
              if (key !== "transfer-encoding") res.setHeader(key, value);
            });
            const buf = await bunRes.arrayBuffer();
            res.end(Buffer.from(buf));
            return;
          }

          const html = transformHtmlForDev(await bunRes.text());

          res.statusCode = bunRes.status;
          res.setHeader("Content-Type", "text/html");
          res.end(html);
          return;
        } catch (e) {
          console.error("SSR proxy error:", e);
        }

        next();
      });
    },
  };
}
