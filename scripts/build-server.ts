/**
 * Build the server bundle with Tailwind CSS plugin so that CSS from
 * entry.html (e.g. src/index.css with @import "tailwindcss") is processed.
 * See https://bun.com/docs/bundler.md and bun-plugin-tailwind.
 */
import plugin from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [plugin],
  minify: true,
});

if (!result.success) {
  console.error("Build failed:");
  for (const msg of result.logs) {
    console.error(msg);
  }
  process.exit(1);
}

for (const msg of result.logs) {
  if (msg.level === "warning") console.warn(msg.message);
}

console.log("Server bundle written to dist/");
