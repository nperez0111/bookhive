import type { ServerRequest } from "srvx";

/** Only call after authorization, for work with its own deadline and abort handling. */
export function disableRequestIdleTimeout(request: Request): boolean {
  // srvx attaches this to the native request; Nitro/Hono preserve its identity.
  const runtime = (request as ServerRequest).runtime;
  if (runtime?.name !== "bun" || !runtime.bun) return false;
  runtime.bun.server.timeout(request, 0);
  return true;
}
