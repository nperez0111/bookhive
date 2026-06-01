import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import path from "path";

/**
 * Build standalone Bun bundles that live outside the Nitro server bundle.
 * Used for worker threads and pino transports that need their own entry points.
 */
function standaloneBundles(): Plugin {
  const bundles = [
    {
      entrypoint: "./src/workers/ingester-worker.ts",
      outdir: "./.output/server/workers",
      name: "ingester-worker.js",
      label: "Ingester worker",
    },
    {
      entrypoint: "./src/workers/open-observe-worker.ts",
      outdir: "./.output/server/workers",
      name: "open-observe-worker.js",
      label: "OpenObserve logger worker",
    },
    {
      entrypoint: "./src/workers/og-render/og-render-worker.tsx",
      outdir: "./.output/server/workers",
      name: "og-render-worker.js",
      label: "OG render worker",
    },
    {
      entrypoint: "./src/workers/import/index.ts",
      outdir: "./.output/server/workers",
      name: "import-worker.js",
      label: "Import worker",
    },
  ];

  return {
    name: "standalone-bundles",
    apply: "build",
    async closeBundle() {
      for (const bundle of bundles) {
        const result = await Bun.build({
          entrypoints: [bundle.entrypoint],
          outdir: bundle.outdir,
          naming: bundle.name,
          target: "bun",
          minify: { whitespace: true, identifiers: true, syntax: false },
          sourcemap: "none",
        });
        if (!result.success) {
          for (const msg of result.logs) console.error(msg);
          throw new Error(`${bundle.label} build failed`);
        }
        for (const msg of result.logs) {
          if (msg.level === "warning") console.warn(msg.message);
        }
        console.log(`${bundle.label} written to ${bundle.outdir}/${bundle.name}`);
      }
    },
  };
}

/**
 * Dev-only: let `/images/*` reach the Nitro/Hono image proxy handler.
 *
 * Nitro's dev middleware (`nitroDevMiddlewarePre`) treats any request whose
 * URL ends in an asset extension (.jpg, .png, ...) with a non-document
 * `sec-fetch-dest` as a static asset and hands it to Vite's static
 * middleware, which 404s because the file doesn't exist on disk. Our image
 * proxy URLs embed the source URL (often ending in `.jpg`) in the path, so
 * real cover requests were being stolen by Vite in dev. Production is
 * unaffected (no Vite). By forcing `sec-fetch-dest: document` for `/images/`
 * requests, Nitro routes them to the Hono catch-all handler instead.
 *
 * Must be `enforce: "pre"` and register its middleware directly in
 * `configureServer` so it runs before Nitro's pre-middleware.
 */
function devImageProxyPassthrough(): Plugin {
  return {
    name: "dev-image-proxy-passthrough",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && req.url.startsWith("/images/")) {
          req.headers["sec-fetch-dest"] = "document";
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    devImageProxyPassthrough(),
    tailwindcss(),
    standaloneBundles(),
    nitro({
      preset: "bun",
      serverEntry: "./server/server.ts",
      plugins: ["./server/plugins/otel-sdk.ts", "./server/plugins/request-tracing.ts"],
    }),
  ],
  server: {
    host: "127.0.0.1",
  },
  root: ".",
  publicDir: "public",
  build: {
    target: "esnext",
    minify: "oxc",
    manifest: true,
    rolldownOptions: {
      input: {
        client: "src/client/index.tsx",
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
  },
});
