/**
 * Nitro plugin: OpenTelemetry SDK lifecycle.
 * Starts the SDK on boot and shuts it down gracefully on close.
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
    instrumentations: [getNodeAutoInstrumentations()],
  });

  if (!env.isDev) {
    sdk.start();
  }

  nitroApp.hooks.hook("close", () => {
    sdk.shutdown();
  });
});
