/**
 * Build only public assets: Tailwind CSS and client JS.
 * Used by `dev` so the layout fallbacks (/public/output.css, /public/js/client.js)
 * work when getBundleAssetUrls() returns empty, and by Docker via full build.
 */

const tailwind = Bun.spawn({
  cmd: [
    "bunx",
    "tailwindcss",
    "-i",
    "./src/index.css",
    "-o",
    "./public/output.css",
    "--minify",
  ],
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});
if ((await tailwind.exited) !== 0) {
  console.error("Tailwind CSS build failed");
  process.exit(1);
}

const clientResult = await Bun.build({
  entrypoints: ["./src/client.tsx"],
  outdir: "./public/js",
  target: "browser",
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: false,
  },
  sourcemap: "external",
});
if (!clientResult.success) {
  console.error("Client build failed:");
  for (const msg of clientResult.logs) console.error(msg);
  process.exit(1);
}

console.log("Assets ready: public/output.css, public/js/client.js");

export {};
