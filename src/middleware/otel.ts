import {
  type Tracer,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

let tracer: Tracer | undefined = trace.getTracer("hono", "0.0.1");

export const opentelemetryMiddleware =
  (): MiddlewareHandler => async (ctx, next) => {
    const span = tracer.startSpan(
      "opentelemetry.infrastructure.middleware",
      {
        attributes: {
          "http.method": ctx.req.method,
          "http.url": ctx.req.url,
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
        ctx.get("ctx").logger.error({ error: ctx.error.message });
        span.recordException(ctx.error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: ctx.error.message,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
    } catch (error) {
      ctx.get("ctx").logger.error({
        error: error instanceof Error ? error.message : "unknown error",
      });
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    }
    span.end();
  };
