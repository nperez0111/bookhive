import { defineNitroConfig } from "nitropack/config"

// https://nitro.build/config
export default defineNitroConfig({
  compatibilityDate: "latest",
  srcDir: "src",
  preset: "bun",
  rollupConfig: {
    external: ["bun", "bun:sqlite"],
  },
});
