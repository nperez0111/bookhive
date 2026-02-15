import {
  type Tracer,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import {
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_HTTP_REQUEST_METHOD,
} from "@opentelemetry/semantic-conventions";

let tracer: Tracer | undefined = trace.getTracer("hono", "0.0.1");

export const opentelemetryMiddleware =
  (): MiddlewareHandler => async (ctx, next) => {
    const span = tracer.startSpan(
      "hono-middleware",
      {
        attributes: {
          [ATTR_HTTP_REQUEST_METHOD]: ctx.req.method,
          [ATTR_URL_PATH]: ctx.req.path,
          [ATTR_URL_FULL]: ctx.req.url,
        },
        kind: SpanKind.SERVER,
      },
      propagation.extract(context.active(), ctx.req.raw.headers),
    );

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        await next();
      });
      if (ctx.error) {
        span.recordException(ctx.error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: ctx.error.message,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    }
    span.end();
  };
