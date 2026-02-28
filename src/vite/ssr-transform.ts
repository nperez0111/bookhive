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
        // Skip if it's a file with an extension or special Vite path
        if (
          !req.url ||
          req.url.includes(".") ||
          req.url.startsWith("/@") ||
          req.url.includes("/node_modules/")
        ) {
          return next();
        }

        // List of routes that should be server-rendered (from Bun)
        const serverRenderedRoutes = [
          "/",
          "/app",
          "/login",
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
          // Fetch HTML from Bun server (port 8080)
          const bunRes = await fetch(`http://localhost:8080${req.url}`, {
            method: req.method,
            headers: {
              host: "localhost:8080",
            },
          });

          let html = await bunRes.text();

          // Transform asset URLs for development
          // Replace production CSS path with Vite dev path
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
