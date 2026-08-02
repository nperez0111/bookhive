/**
 * Nitro plugin: OpenTelemetry SDK lifecycle.
 * Starts the SDK on boot and shuts it down gracefully on close.
 *
 * Traces reach OpenObserve at `${OPEN_OBSERVE_URL}/api/bookhive/v1/traces`, so
 * `OPEN_OBSERVE_URL` must be **container-reachable** — `http://openobserve:5080`
 * on the shared `backbone` network. Never `localhost`, which inside this
 * container is the app itself. The repo's compose.yaml said `localhost` while
 * the deployment said `openobserve`, and that mismatch is exactly how this
 * pipeline was once misdiagnosed as dead. It is not: verified 2026-08-02, the
 * `traces/default` stream holds 13.7M spans and is current.
 */
import { definePlugin } from "nitro";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { env } from "../../src/env";

export default definePlugin((nitroApp) => {
  const traceExporter =
    !env.isDev && env.OPEN_OBSERVE_URL && env.OPEN_OBSERVE_USER && env.OPEN_OBSERVE_PASSWORD
      ? new OTLPTraceExporter({
          url: `${env.OPEN_OBSERVE_URL}/api/bookhive/v1/traces`,
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${env.OPEN_OBSERVE_USER}:${env.OPEN_OBSERVE_PASSWORD}`,
            ).toString("base64")}`,
          },
        })
      : new ConsoleSpanExporter();

  const sdk = new NodeSDK({
    serviceName: "bookhive",
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // A span per filesystem operation. Every static asset read, every
        // SQLite-adjacent stat, in every worker — the standard advice is to
        // leave this off, and an unconfigured `getNodeAutoInstrumentations()`
        // turns it on.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        // Inbound requests already get a root span from request-tracing.ts and
        // a route span from src/middleware/otel-middleware.ts. A third would be
        // noise. Outbound stays on: a PDS that stops answering and Goodreads
        // refusing us are precisely what the incidents were about.
        "@opentelemetry/instrumentation-http": { ignoreIncomingRequestHook: () => true },
      }),
    ],
  });

  if (!env.isDev) {
    sdk.start();
  }

  nitroApp.hooks.hook("close", async () => {
    await sdk.shutdown();
  });
});
