import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";
import { ssrHtmlTransform } from "./src/vite/ssr-transform";

export default defineConfig({
  plugins: [tailwindcss(), ssrHtmlTransform()],
  root: ".",
  publicDir: "public",
  server: {
    host: "127.0.0.1",
    middlewareMode: false,
    port: 5173,
    strictPort: false,
    hmr: {
      // Explicit host so WebSocket connects correctly when proxying to Bun
      host: "127.0.0.1",
      port: 5173,
      overlay: false,
    },
    watch: {
      // Ignore paths that can trigger spurious HMR (cache, logs, build output)
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/.mcp_data/**",
        "**/*.log",
        "**/.vite/**",
      ],
    },
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
