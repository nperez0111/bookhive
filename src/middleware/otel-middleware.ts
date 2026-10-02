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

export const opentelemetryMiddleware = (): MiddlewareHandler => async (ctx, next) => {
  const span = tracer.startSpan(
    // Method only, to avoid one operation name per URL; renamed to the matched route below once routing happens.
    ctx.req.method,
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
  } finally {
    // In `finally`, not after the try: a throwing `next()` used to rethrow past `span.end()`, leaving the span never ended or exported.
    // `routePath` is the matched pattern (`/books/:hiveId`), not the concrete URL, so aggregation works without minting a name per id.
    try {
      const routePath = ctx.req.routePath;
      if (routePath && routePath !== "/*") {
        span.updateName(`${ctx.req.method} ${routePath}`);
        span.setAttribute("http.route", routePath);
      }
      span.setAttribute("http.status_code", ctx.res.status);
    } catch {
      // Guarded so a throw here (this runs on the throwing path too) can't replace the request's real error.
    }
    span.end();
  }
};
