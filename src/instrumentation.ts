/**
 * OpenTelemetry setup using the Node.js SDK.
 * See https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { env } from "./env";

const traceExporter =
  !env.isDev &&
  env.OPEN_OBSERVE_URL &&
  env.OPEN_OBSERVE_USER &&
  env.OPEN_OBSERVE_PASSWORD
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
