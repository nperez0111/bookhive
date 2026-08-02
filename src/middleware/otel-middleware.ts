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
    // Renamed to the matched route once routing has happened — see updateName
    // below. This initial value only survives if the request throws before a
    // route matches.
    `${ctx.req.method} ${ctx.req.path}`,
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
    // Every span used to be called "hono-middleware": 82.6% of an hour's 2,341
    // production spans shared that single name, so nothing could be grouped,
    // ranked or compared. `routePath` is only known after routing, and it is
    // the matched *pattern* (`/books/:hiveId`) rather than the concrete URL —
    // so per-route aggregation works without minting a distinct operation name
    // for every book id.
    const routePath = ctx.req.routePath;
    if (routePath && routePath !== "/*") {
      span.updateName(`${ctx.req.method} ${routePath}`);
      span.setAttribute("http.route", routePath);
    }
    span.setAttribute("http.status_code", ctx.res.status);
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
