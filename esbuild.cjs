const esbuild = require("esbuild");
const { nodeExternalsPlugin } = require("esbuild-node-externals");

Promise.all([
  esbuild.build({
    entryPoints: ["src/index.ts", "src/logger/open-observe.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outdir: "dist",
    sourcemap: true,
    plugins: [nodeExternalsPlugin()],
  }),
  esbuild.build({
    entryPoints: ["src/instrumentation.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: "dist/instrumentation.cjs",
    sourcemap: true,
    plugins: [nodeExternalsPlugin()],
  }),
]).catch(() => process.exit(1));
