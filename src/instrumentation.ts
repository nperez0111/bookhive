import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
// import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
// import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { env } from "./env";

const authHeader = `Basic ${Buffer.from(
  `${env.OPEN_OBSERVE_USER}:${env.OPEN_OBSERVE_PASSWORD}`,
).toString("base64")}`;

const sdk = new NodeSDK({
  traceExporter:
    env.isDev || !env.OPEN_OBSERVE_URL
      ? undefined
      : new OTLPTraceExporter({
          url: `${env.OPEN_OBSERVE_URL}/api/bookhive/traces`,
          headers: {
            Authorization: authHeader,
          },
        }),
  // metricReader: env.isDev || !env.OPEN_OBSERVE_URL
  //   ? undefined
  //   : new PeriodicExportingMetricReader({
  //       exportIntervalMillis: 2000,
  //       exporter: new OTLPMetricExporter({
  //         url: `${env.OPEN_OBSERVE_URL}/api/bookhive`,
  //         headers: {
  //           Authorization: authHeader,
  //           "stream-name": "default",
  //         },
  //       }),
  //     }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
