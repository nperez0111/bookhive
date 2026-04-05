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
      outdir: "./.output/server",
      name: "ingester-worker.js",
      label: "Ingester worker",
    },
    {
      entrypoint: "./src/workers/open-observe-worker.ts",
      outdir: "./.output/server/logger",
      name: "open-observe-worker.js",
      label: "OpenObserve logger worker",
    },
    {
      entrypoint: "./src/workers/og-render/og-render-worker.tsx",
      outdir: "./.output/server/workers/og-render",
      name: "og-render-worker.js",
      label: "OG render worker",
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

export default defineConfig({
  plugins: [
    tailwindcss(),
    standaloneBundles(),
    nitro({
      preset: "bun",
      serverEntry: "./server/server.ts",
      plugins: ["./server/plugins/otel-sdk.ts", "./server/plugins/request-tracing.ts"],
      // @takumi-rs/core is a NAPI-RS native module not in nf3's NodeNativePackages list;
      // adding it here ensures Nitro traces and copies the platform-specific binary.
      // See: https://github.com/unjs/nf3 — can be removed once nf3 auto-detects NAPI-RS packages.
      traceDeps: ["@takumi-rs/core"],
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
