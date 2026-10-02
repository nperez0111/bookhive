/**
 * Nitro plugin: OpenTelemetry SDK lifecycle — starts on boot, shuts down on close.
 *
 * `OPEN_OBSERVE_URL` must be container-reachable (e.g. `http://openobserve:5080`
 * on the shared `backbone` network), never `localhost` — inside this container
 * that resolves to the app itself, not the collector.
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
        // A span per filesystem op in every worker is noise; off despite being on by default in an unconfigured getNodeAutoInstrumentations().
        "@opentelemetry/instrumentation-fs": { enabled: false },
        // Inbound already gets spans from request-tracing.ts + otel-middleware.ts.
        // Outbound stays on — PDS/Goodreads failures are what we need to see.
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
