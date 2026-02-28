import { type Plugin, type ViteDevServer } from "vite";

/**
 * SSR transform plugin for development mode.
 *
 * Proxies HTML requests from Vite (5173) to Bun server (8080),
 * then injects Vite client and asset URLs for HMR and styling.
 *
 * This allows dev mode to run Vite and Bun in parallel, with
 * Vite handling CSS/JS and Bun handling server rendering.
 */
export function ssrHtmlTransform(): Plugin {
  return {
    name: "ssr-html-transform",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        // Only proxy HTML requests (not static assets, modules, or HMR)
        // Skip if it's a file with an extension (check pathname only; query can contain dots e.g. OAuth callback iss=)
        if (!req.url) return next();
        const pathname = req.url.replace(/\?.*/, "");
        if (
          (!pathname.startsWith("/images") && pathname.includes(".")) ||
          req.url.startsWith("/@") ||
          req.url.includes("/node_modules/")
        ) {
          return next();
        }

        // List of routes that should be server-rendered or handled by Bun
        const serverRenderedRoutes = [
          "/",
          "/app",
          "/login",
          "/oauth/",
          "/images/",
          "/books/",
          "/profile",
          "/genres",
          "/authors",
          "/import",
          "/privacy-policy",
        ];

        const shouldProxy = serverRenderedRoutes.some(
          (route) => req.url === route || req.url?.startsWith(route),
        );

        if (!shouldProxy) {
          return next();
        }

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
              // Forward Set-Cookie (e.g. session from OAuth callback); getSetCookie returns all
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
            // Forward non-HTML as-is (e.g. JSON, empty body)
            res.statusCode = bunRes.status;
            bunRes.headers.forEach((value, key) => {
              if (key !== "transfer-encoding") res.setHeader(key, value);
            });
            const buf = await bunRes.arrayBuffer();
            res.end(Buffer.from(buf));
            return;
          }

          let html = await bunRes.text();

          // Transform asset URLs for development
          html = html.replace(
            'href="/assets/style.css"',
            'href="/src/index.css"',
          );

          // Inject Vite client for HMR (hot module replacement)
          if (!html.includes("/@vite/client")) {
            html = html.replace(
              "</head>",
              `<script type="module" src="/@vite/client"></script>
    </head>`,
            );
          }

          // Inject client JS entry point
          html = html.replace(
            "</body>",
            `<script type="module" src="/src/client/index.tsx"></script>
    </body>`,
          );

          res.statusCode = bunRes.status;
          res.setHeader("Content-Type", "text/html");
          res.end(html);
          return;
        } catch (e) {
          console.error("SSR proxy error:", e);
          // Fall through to next middleware on error
        }

        next();
      });
    },
  };
}
