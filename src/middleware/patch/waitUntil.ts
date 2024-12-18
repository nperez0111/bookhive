import type { ExecutionContext } from "hono";
import { PromiseStore } from "../promiseStore";

/**
 * This returns a proxy-ed ExecutionContext which has a waitUntil method that
 * collects promises passed to it. It also returns an array of promises that
 */
export function patchWaitUntil(
  context: ExecutionContext,
  store: PromiseStore = new PromiseStore(),
) {
  const proxyContext = new Proxy(context, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "waitUntil" && typeof value === "function") {
        const original: ExecutionContext["waitUntil"] = value;
        return function waitUntil(this: unknown, promise: Promise<unknown>) {
          const scope = this === receiver ? target : this;
          store.add(promise);
          return original.apply(scope, [promise]);
        };
      }

      return value;
    },
  });

  return proxyContext;
}