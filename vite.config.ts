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
      if (source === "bun" || source.startsWith("bun:")) return { id: source, external: true };
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
    {
      entrypoint: "./src/scrapers/waf/solver-worker.ts",
      outdir: "./.output/server/workers",
      name: "waf-solver-worker.js",
      label: "WAF solver worker",
    },
    {
      entrypoint: "./src/workers/parse-worker.ts",
      outdir: "./.output/server/workers",
      name: "parse-worker.js",
      label: "Ebook parse worker",
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
        if (req.url && (req.url.startsWith("/images/") || req.url.startsWith("/library/covers/"))) {
          req.headers["sec-fetch-dest"] = "document";
        }
        next();
      });
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vite-plus extends the config type beyond what defineConfig accepts
export default defineConfig(({ command }): any => ({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["src/scrapers/waf/__fixtures__/"],
  },
  fmt: {
    ignorePatterns: ["src/scrapers/waf/__fixtures__/"],
  },
  plugins: [
    bunRuntimeExternal(),
    devImageProxyPassthrough(),
    tailwindcss(),
    standaloneBundles(),
    nitro({
      preset: "bun",
      // Production-only runtime entry: a copy of the bun preset entry with
      // SO_REUSEPORT enabled so server/cluster.ts workers share port 8080.
      // Build-only — overriding in dev would replace the nitro-dev entry and
      // break `vp dev`.
      ...(command === "build" ? { entry: "./server/entry.bun.mjs" } : {}),
      serverEntry: "./server/server.ts",
      plugins: [
        "./server/plugins/otel-sdk.ts",
        "./server/plugins/request-tracing.ts",
        "./server/plugins/cache-headers.ts",
      ],
      // Native NAPI-RS bindings, which resolve their platform-specific `.node`
      // at runtime and so never appear in the Rolldown bundle graph. The `*`
      // suffix is a full trace, which is what copies the optional per-platform
      // binding packages (…-linux-x64-musl for this Alpine image) into
      // .output/server/node_modules/.
      //
      // - @takumi-rs/core: loaded by the OG render worker.
      // - @resvg/resvg-js: rasterizes SVG book covers on the upload path.
      //   Missing it does NOT crash — `prepareCover` catches and returns null —
      //   so an untraced build silently uploads every Standard Ebooks book with
      //   no cover, which is precisely the bug this was added to fix.
      traceDeps: ["@takumi-rs/core*", "@resvg/resvg-js*"],
      // Longer cache lifetimes for static assets (fixes Lighthouse "cache lifetime" warnings).
      // Vite emits content-hashed files under /assets/* → safe to cache immutably for 1 year.
      //
      // ONLY prefix globs belong here. Extension globs (`/**\/*.png`) are a trap:
      // rou3 stops parsing a pattern at the first `**` segment and throws the rest
      // away, so `/**\/*.png` is really `/**` and matches every route — and nitro's
      // route-rule header middleware *overwrites* the Hono-set Cache-Control on any
      // 2xx response. That is how personalized HTML (/home, /profile/*, /library)
      // came to advertise `public, max-age=2592000`, which let a browser replay the
      // previous account's page after switching accounts.
      //
      // Files under public/ have stable names rather than content hashes, so they
      // get a long TTL + stale-while-revalidate (not `immutable`) from
      // staticAssetCacheControl() in server/plugins/cache-headers.ts.
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
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 8080,
    allowedHosts: true,
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
}));
