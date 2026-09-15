/**
 * Repo-local replacement for nitro's bun preset runtime entry
 * (node_modules/nitro/dist/presets/bun/runtime/bun.mjs, nitro 3.0.260610-beta),
 * wired in via `entry` in vite.config.ts (production builds only). Diff
 * against upstream on nitro upgrades.
 *
 * The one functional change: `reusePort: true`, so the N worker processes
 * spawned by server/cluster.ts can all bind port 8080 and the kernel
 * load-balances across them (SO_REUSEPORT — Linux only, harmless elsewhere).
 *
 * Dropped vs upstream (all unused here): TLS (Caddy/Cloudflare terminate it),
 * the websocket branch, startScheduleRunner, and trapUnhandledErrors (its
 * `#nitro/runtime/*` import doesn't resolve from repo files — inlined below
 * via the public nitroApp.captureError instead).
 */
import "#nitro/virtual/polyfills";
import { serve } from "srvx/bun";
import { useNitroApp } from "nitro/app";
import { tracingSrvxPlugins } from "#nitro/virtual/tracing";

const _parsedPort = Number.parseInt(process.env.NITRO_PORT ?? process.env.PORT ?? "");
const port = Number.isNaN(_parsedPort) ? 3000 : _parsedPort;
const host = process.env.NITRO_HOST || process.env.HOST;

const nitroApp = useNitroApp();

serve({
  port,
  hostname: host,
  reusePort: true,
  fetch: nitroApp.fetch,
  plugins: [...tracingSrvxPlugins],
});

// Inlined from nitro's trapUnhandledErrors (#nitro/runtime/error/hooks).
// Emitted as one JSON line — a raw console.error(error) prints multi-line stack traces that break the JSON log pipeline.
function captureError(error, type) {
  console.error(
    JSON.stringify({
      level: 50,
      time: Date.now(),
      msg: type,
      error: {
        message: error?.message ?? String(error),
        type: error?.name ?? "Error",
        stack: typeof error?.stack === "string" ? error.stack.slice(0, 4000) : undefined,
      },
    }),
  );
  nitroApp.captureError?.(error, { tags: [type] });
}
process.on("unhandledRejection", (error) => captureError(error, "unhandledRejection"));
process.on("uncaughtException", (error) => captureError(error, "uncaughtException"));

export default {};
