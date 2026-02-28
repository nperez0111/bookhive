import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";
import { ssrHtmlTransform } from "./src/vite/ssr-transform";

export default defineConfig({
  plugins: [tailwindcss(), ssrHtmlTransform()],
  root: ".",
  publicDir: "public",
  server: {
    middlewareMode: false,
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "dist/public",
    target: "esnext",
    minify: "esbuild",
    manifest: true,
    rollupOptions: {
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
