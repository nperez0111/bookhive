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
    // Method only. Renamed to the matched route once routing has happened (see
    // updateName below), so this value survives just for requests that throw
    // before a route matches — and those are exactly the ones with arbitrary
    // paths. Interpolating the raw path here would mint a distinct operation
    // name per URL, which is the cardinality blow-up this rename exists to
    // avoid. The full path is still on the span as ATTR_URL_PATH.
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
    // In `finally`, not after the try: a throwing `next()` used to rethrow past
    // `span.end()`, so the span was never ended and never exported. That lost
    // the trace for exactly the requests worth tracing, and left the span
    // pinned in the SDK.
    //
    // Every span used to be called "hono-middleware": 82.6% of an hour's 2,341
    // production spans shared that single name, so nothing could be grouped,
    // ranked or compared. `routePath` is only known after routing, and it is
    // the matched *pattern* (`/books/:hiveId`) rather than the concrete URL —
    // so per-route aggregation works without minting a distinct operation name
    // for every book id.
    try {
      const routePath = ctx.req.routePath;
      if (routePath && routePath !== "/*") {
        span.updateName(`${ctx.req.method} ${routePath}`);
        span.setAttribute("http.route", routePath);
      }
      span.setAttribute("http.status_code", ctx.res.status);
    } catch {
      // Guarded because this now runs on the throwing path too, and a throw
      // from a `finally` would *replace* the request's real error with a
      // telemetry one. Ending the span still matters more than labelling it.
    }
    span.end();
  }
};
