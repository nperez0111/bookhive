import { SpanKind, context, propagation, trace } from "@opentelemetry/api";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { ExecutionContext } from "hono";
import { measure } from "./measure";
import { patchFetch, patchWaitUntil } from "./patch";
import { PromiseStore } from "./promiseStore";
import type { HonoLikeApp, HonoLikeEnv, HonoLikeFetch } from "./types";
import {
  getRequestAttributes,
  getResponseAttributes,
  getRootRequestAttributes,
} from "./utils";

/**
 * The type for the configuration object we use to configure the instrumentation
 * Different from @FpxConfigOptions because all properties are required
 *
 * @internal
 */
type FpxConfig = {
  /** Enable library debug logging */
  libraryDebugMode: boolean;
  /**
   * The name of the service that is being instrumented.
   */
  serviceName?: string;
  /**
   * Ignore certain requests from being instrumented.
   */
  ignore?: (request: Request) => boolean;
  /**
   * Enable or disable the instrumentation
   * @default true
   */
  isEnabled?: boolean;
};

/**
 * The type for the configuration object the user might pass to `instrument`
 * Different from @FpxConfig because all properties are optional
 *
 * @public
 */
type FpxConfigOptions = Partial<FpxConfig>;

const defaultConfig = {
  libraryDebugMode: false,
  serviceName: "hono",
};

export function instrument(app: HonoLikeApp, config?: FpxConfigOptions) {
  const tracer = trace.getTracer("hono", "0.0.1");

  return new Proxy(app, {
    // Intercept the `fetch` function on the Hono app instance
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "fetch" && typeof value === "function") {
        const originalFetch = value as HonoLikeFetch;
        return async function fetch(
          request: Request,
          // Name this "rawEnv" because we coerce it below into something that's easier to work with
          rawEnv: HonoLikeEnv,
          executionContext?: ExecutionContext,
        ) {
          // Merge the default config with the user's config
          const { serviceName, isEnabled } = mergeConfigs(
            defaultConfig,
            config,
          );

          if (!isEnabled) {
            return await originalFetch(request, rawEnv, executionContext);
          }

          if (config?.ignore && config.ignore(request)) {
            return await originalFetch(request, rawEnv, executionContext);
          }

          patchFetch();

          const span = tracer.startSpan(
            new URL(request.url).pathname,
            {
              attributes: {
                [ATTR_SERVICE_NAME]: serviceName,
              },
              kind: SpanKind.SERVER,
            },
            propagation.extract(context.active(), request.headers),
          );
          const promiseStore = new PromiseStore();

          // Enable tracing for waitUntil
          const proxyExecutionCtx =
            executionContext && patchWaitUntil(executionContext, promiseStore);

          // HACK - Duplicate request to be able to read the body and other metadata
          //        in the middleware without messing up the original request
          const clonedRequest = request.clone();
          const [body1, body2] = clonedRequest.body
            ? clonedRequest.body.tee()
            : [null, null];

          // In order to keep `onStart` synchronous (below), we construct
          // some necessary attributes here, using a cloned request
          const requestForAttributes = new Request(clonedRequest.url, {
            method: request.method,
            headers: new Headers(request.headers),
            body: body1,

            // NOTE - This is a workaround to support node environments
            //        Which will throw errors when body is a stream but duplex is not set
            //        https://github.com/nodejs/node/issues/46221
            // @ts-expect-error - duplex is available in nodejs-compat but cloudflare types
            // don't seem to pick it up
            duplex: body1 ? "half" : undefined,
          });

          // Replace the original request's body with the second stream
          const newRequest = new Request(clonedRequest, {
            body: body2,
            headers: new Headers(request.headers),
            method: request.method,
            // NOTE - This is a workaround to support node environments
            //        Which will throw errors when body is a stream but duplex is not set
            //        https://github.com/nodejs/node/issues/46221
            // @ts-expect-error - duplex is available in nodejs-compat but cloudflare types
            // don't seem to pick it up
            duplex: body2 ? "half" : undefined,
          });

          // Parse the body and headers for the root request.
          //
          // NOTE - This will add some latency, and it will serialize the env object.
          //        We should not do this in production!
          const rootRequestAttributes =
            await getRootRequestAttributes(requestForAttributes);

          const measuredFetch = measure(
            {
              name: "request",
              spanKind: SpanKind.SERVER,
              onStart: (span, [request]) => {
                const requestAttributes = {
                  ...getRequestAttributes(request),
                  ...rootRequestAttributes,
                };
                span.setAttributes(requestAttributes);
              },
              endSpanManually: true,
              onSuccess: async (span, response) => {
                span.addEvent("first-response");

                const attributesResponse = response.clone();

                const updateSpan = async (response: Response) => {
                  const attributes = await getResponseAttributes(response);
                  span.setAttributes(attributes);
                  span.end();
                };

                promiseStore.add(updateSpan(attributesResponse));
              },
              checkResult: async (result) => {
                const r = await result;
                if (r.status >= 500) {
                  throw new Error(r.statusText);
                }
              },
            },
            originalFetch,
          );

          try {
            return await context.with(
              trace.setSpan(context.active(), span),
              () => measuredFetch(newRequest, rawEnv, proxyExecutionCtx),
            );
          } finally {
            // Make sure all promises are resolved before sending data to the server
            if (proxyExecutionCtx) {
              proxyExecutionCtx.waitUntil(
                promiseStore.allSettled().finally(() => {
                  return span.end();
                }),
              );
            } else {
              // Otherwise just await flushing the provider
              span.end();
            }
          }
        };
      }

      // Keep all the other things accessible
      return value;
    },
  });
}

/**
 * Last-in-wins deep merge for FpxConfig
 */
function mergeConfigs(
  fallbackConfig: FpxConfig,
  userConfig?: FpxConfigOptions,
): FpxConfig {
  const libraryDebugMode =
    typeof userConfig?.libraryDebugMode === "boolean"
      ? userConfig.libraryDebugMode
      : fallbackConfig.libraryDebugMode;

  return {
    libraryDebugMode,
    serviceName: userConfig?.serviceName ?? fallbackConfig.serviceName,
    ignore: userConfig?.ignore ?? undefined,
    isEnabled: userConfig?.isEnabled ?? true,
  };
}
