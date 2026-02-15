/**
 * Build the server bundle with Tailwind CSS plugin so that CSS from
 * entry.html (e.g. src/index.css with @import "tailwindcss") is processed.
 * Also builds the pino OpenObserve transport as a separate bundle so it can
 * be loaded by pino at runtime in Docker (target: "./logger/open-observe.js").
 * Runs build:assets first so public/output.css and public/js/client.js exist.
 * See https://bun.com/docs/bundler.md and bun-plugin-tailwind.
 */
import plugin from "bun-plugin-tailwind";

// Build public assets first (shared with dev via build:assets)
const assets = Bun.spawn({
  cmd: ["bun", "run", "scripts/build-assets.ts"],
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});
if ((await assets.exited) !== 0) process.exit(1);

// Build server bundle
const mainResult = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [plugin],
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: false,
  },
  sourcemap: "external",
});

if (!mainResult.success) {
  console.error("Build failed:");
  for (const msg of mainResult.logs) {
    console.error(msg);
  }
  process.exit(1);
}

// Build pino transport so it exists at dist/logger/open-observe.js for production
const transportResult = await Bun.build({
  entrypoints: ["./src/logger/open-observe.ts"],
  outdir: "./dist/logger",
  target: "bun",
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: false,
  },
  sourcemap: "external",
});

if (!transportResult.success) {
  console.error("Transport build failed:");
  for (const msg of transportResult.logs) {
    console.error(msg);
  }
  process.exit(1);
}

for (const msg of [...mainResult.logs, ...transportResult.logs]) {
  if (msg.level === "warning") console.warn(msg.message);
}

console.log("Server bundle written to dist/");
console.log("Logger transport written to dist/logger/");
