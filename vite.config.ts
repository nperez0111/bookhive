import { execSync } from "child_process";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite-plus";
import path from "path";

// Bun runtime built-in must be external — Rolldown can't bundle it.
function bunRuntimeExternal(): Plugin {
  return {
    name: "bun-runtime-external",
    resolveId(source) {
      if (source === "bun") return { id: "bun", external: true };
    },
  };
}

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
    closeBundle() {
      for (const bundle of bundles) {
        const cmd = `bun build ${bundle.entrypoint} --outdir ${bundle.outdir} --entry-naming ${bundle.name} --target bun --minify-whitespace --minify-identifiers`;
        execSync(cmd, { stdio: "inherit" });
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
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    ignorePatterns: [],
  },
  plugins: [
    bunRuntimeExternal(),
    devImageProxyPassthrough(),
    tailwindcss(),
    standaloneBundles(),
    nitro({
      preset: "bun",
      serverEntry: "./server/server.ts",
      plugins: ["./server/plugins/otel-sdk.ts", "./server/plugins/request-tracing.ts"],
      // The OG render worker loads @takumi-rs/core (native NAPI-RS bindings) at
      // runtime in a worker thread, so it never appears in the Rolldown bundle
      // graph. Explicitly trace it (full trace `*` to copy the platform-specific
      // optional binding packages) into .output/server/node_modules/.
      traceDeps: ["@takumi-rs/core*"],
      // Longer cache lifetimes for static assets (fixes Lighthouse "cache lifetime" warnings).
      // Vite emits content-hashed files under /assets/* → safe to cache immutably for 1 year.
      // Files under public/ have stable names, so use a long TTL + stale-while-revalidate
      // rather than immutable, so updates still propagate.
      routeRules: {
        "/assets/**": {
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        },
        "/js/**": {
          headers: { "Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400" },
        },
        "/screenshots/**": {
          headers: { "Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400" },
        },
        "/**/*.svg": {
          headers: { "Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400" },
        },
        "/**/*.png": {
          headers: { "Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400" },
        },
        "/**/*.jpg": {
          headers: { "Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400" },
        },
        "/**/*.ico": {
          headers: { "Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400" },
        },
        "/**/*.webmanifest": {
          headers: { "Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400" },
        },
      },
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
