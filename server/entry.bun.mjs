/**
 * Repo-local replacement for nitro's bun preset runtime entry
 * (node_modules/nitro/dist/presets/bun/runtime/bun.mjs, nitro 3.0.260610-beta)
 * wired in via the `entry` option in vite.config.ts (production builds only).
 * On nitro upgrades, diff against the upstream file.
 *
 * The one functional change: `reusePort: true`, so N worker processes spawned
 * by server/cluster.ts can all bind port 8080 and the kernel load-balances
 * accepts across them (SO_REUSEPORT — Linux only; harmless single-process and
 * on macOS).
 *
 * Dropped vs upstream (all unused by this app):
 * - TLS (NITRO_SSL_CERT/KEY) — external Caddy/Cloudflare terminate TLS.
 * - The websocket branch — no crossws/websocket usage.
 * - startScheduleRunner — no nitro tasks.
 * - trapUnhandledErrors — imported from `#nitro/runtime/*`, which is a
 *   package-scoped subpath import that does not resolve from repo files;
 *   inlined below via the public nitroApp.captureError instead.
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

// Inlined from nitro's trapUnhandledErrors (#nitro/runtime/error/hooks)
function captureError(error, type) {
  console.error(`[${type}]`, error);
  nitroApp.captureError?.(error, { tags: [type] });
}
process.on("unhandledRejection", (error) => captureError(error, "unhandledRejection"));
process.on("uncaughtException", (error) => captureError(error, "uncaughtException"));

export default {};
