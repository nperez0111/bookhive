import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [
    tailwindcss(),
    nitro({
      preset: "bun",
      serverEntry: "./server/server.ts",
      // @takumi-rs/core is a NAPI-RS native module not in nf3's NodeNativePackages list;
      // adding it here ensures Nitro traces and copies the platform-specific binary.
      // See: https://github.com/unjs/nf3 — can be removed once nf3 auto-detects NAPI-RS packages.
      traceDeps: ["@takumi-rs/core"],
      // pino and thread-stream spawn worker threads using paths relative to their own files.
      // Bundling them breaks worker resolution (worker.js ends up at _libs/lib/worker.js).
      // Externalizing ensures they're copied as full packages to .output/server/node_modules/.
      externals: {
        external: ["pino", "thread-stream"],
        traceInclude: ["pino", "thread-stream"],
      },
    }),
  ],
  server: {
  	host: '127.0.0.1'
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
