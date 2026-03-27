/**
 * Nitro plugin: Lightweight root span per request.
 * No body cloning, no PromiseStore — just timing + URL/method/status attributes.
 */
import { definePlugin } from "nitro";
import {
  type Span,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";

const SKIP_PATHS = new Set(["/healthcheck", "/metrics"]);
const SKIP_PREFIXES = ["/public/", "/images/"];

function shouldSkip(pathname: string): boolean {
  if (SKIP_PATHS.has(pathname)) return true;
  return SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

export default definePlugin((nitroApp) => {
  const tracer = trace.getTracer("bookhive");
  const spans = new WeakMap<object, { span: Span; start: number }>();

  nitroApp.hooks.hook("request", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    if (shouldSkip(url.pathname)) return;

    const parentCtx = propagation.extract(context.active(), req.headers);
    const span = tracer.startSpan(
      url.pathname,
      {
        attributes: {
          "http.method": req.method,
          "url.path": url.pathname,
        },
        kind: SpanKind.SERVER,
      },
      parentCtx,
    );

    spans.set(event, { span, start: performance.now() });
  });

  nitroApp.hooks.hook("response", (response, event) => {
    const entry = spans.get(event);
    if (!entry) return;

    const { span, start } = entry;
    span.setAttribute("http.status_code", response.status);
    span.setStatus({
      code: response.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });

    // Append root timing to Server-Timing header
    const dur = performance.now() - start;
    const existing = response.headers.get("Server-Timing") ?? "";
    const rootTiming = `root;dur=${dur.toFixed(1)}`;
    response.headers.set("Server-Timing", existing ? `${rootTiming},${existing}` : rootTiming);

    span.end();
    spans.delete(event);
  });

  nitroApp.hooks.hook("error", (error, ctx) => {
    if (ctx.event) {
      const entry = spans.get(ctx.event);
      if (entry) {
        entry.span.recordException(error);
        entry.span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        entry.span.end();
        spans.delete(ctx.event);
      }
    }
  });
});
