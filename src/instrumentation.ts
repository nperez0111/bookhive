import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { env } from "./env";
// import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// // For troubleshooting, set the log level to DiagLogLevel.DEBUG
// diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.VERBOSE);

const authHeader = `Basic ${Buffer.from(
  `${env.OPEN_OBSERVE_USER}:${env.OPEN_OBSERVE_PASSWORD}`,
).toString("base64")}`;

const sdk = new NodeSDK({
  serviceName: "bookhive",
  traceExporter:
    env.isDev || !env.OPEN_OBSERVE_URL
      ? undefined
      : new OTLPTraceExporter({
          url: `${env.OPEN_OBSERVE_URL}/api/bookhive/traces`,
          headers: {
            Authorization: authHeader,
          },
        }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": {
        ignoreIncomingRequestHook: (request) => {
          return Boolean(
            request.url?.includes("/healthcheck") ||
              request.url?.includes("/metrics"),
          );
        },
      },
    }),
  ],
});

sdk.start();
