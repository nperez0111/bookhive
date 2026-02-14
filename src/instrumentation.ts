/**
 * OpenTelemetry tracing setup for Bun. Runs when imported at the top of index.ts.
 * Uses the base trace SDK (no Node SDK). Spans are created by Hono middleware
 * (opentelemetryMiddleware + instrument()).
 */
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  BasicTracerProvider,
} from "@opentelemetry/sdk-trace-base";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { env } from "./env";

const provider = new BasicTracerProvider({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: "bookhive",
  }),
});

if (!env.isDev && env.OPEN_OBSERVE_URL && env.OPEN_OBSERVE_USER && env.OPEN_OBSERVE_PASSWORD) {
  const authHeader = `Basic ${Buffer.from(
    `${env.OPEN_OBSERVE_USER}:${env.OPEN_OBSERVE_PASSWORD}`,
  ).toString("base64")}`;

  provider.addSpanProcessor(
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `${env.OPEN_OBSERVE_URL}/api/bookhive/traces`,
        headers: {
          Authorization: authHeader,
        },
      }),
    ),
  );
}

trace.setGlobalTracerProvider(provider);
