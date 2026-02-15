import type { Attributes } from "@opentelemetry/api";
import {
  SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH,
  SEMATTRS_HTTP_SCHEME,
} from "@opentelemetry/semantic-conventions";
import {
  EXTRA_SEMATTRS_HTTP_REQUEST_METHOD,
  EXTRA_SEMATTRS_HTTP_RESPONSE_STATUS_CODE,
  EXTRA_SEMATTRS_URL_FULL,
} from "./constants";
import type {
  GlobalResponse,
  HonoResponse,
  InitParam,
  InputParam,
} from "../types";

// There are so many different types of headers
// and we want to support all of them so we can
// use a single function to do it all
type PossibleHeaders =
  | Headers
  | HonoResponse["headers"]
  | GlobalResponse["headers"];

export function headersToObject(headers: PossibleHeaders) {
  const returnObject: Record<string, string> = {};
  headers.forEach((value, key) => {
    returnObject[key] = value;
  });

  return returnObject;
}

/**
 * Helper to get the request attributes for the root request.
 *
 * Requires that we have a cloned request, so we can get the body and headers
 * without consuming the original request.
 */
export async function getRootRequestAttributes(request: Request) {
  let attributes: Attributes = {};

  if (request.headers) {
    const headers = headersToObject(new Headers(request.headers));
    for (const [key, value] of Object.entries(headers)) {
      attributes[`http.request.header.${key}`] = value;
    }
  }

  return attributes;
}

export function getRequestAttributes(input: InputParam, init?: InitParam) {
  const requestMethod =
    typeof input === "string" || input instanceof URL ? "GET" : input.method;
  const requestUrl = input instanceof Request ? input.url : input;
  const url = new URL(requestUrl);
  const attributes: Attributes = {
    [EXTRA_SEMATTRS_HTTP_REQUEST_METHOD]: requestMethod,
    // [HTTP_REQUEST_METHOD_ORIGINAL]: request.method,
    // TODO: remove login/password from URL (if we want to follow
    // the otel spec for this attribute)
    // TODO: think about how to handle a redirect
    [EXTRA_SEMATTRS_URL_FULL]: url.toString(),
  };

  // Init should not be null or undefined
  if (init) {
    if (init.headers) {
      const headers = headersToObject(new Headers(init.headers));
      for (const [key, value] of Object.entries(headers)) {
        attributes[`http.request.header.${key}`] = value;
      }
    }
  }

  return attributes;
}

export async function getResponseAttributes(
  response: GlobalResponse | HonoResponse,
) {
  const attributes: Attributes = {
    [EXTRA_SEMATTRS_HTTP_RESPONSE_STATUS_CODE]: String(response.status),
    [SEMATTRS_HTTP_SCHEME]: response.url.split(":")[0],
  };

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    attributes[SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH] = contentLength;
  }

  const headers = response.headers;
  const responseHeaders = headersToObject(headers);
  for (const [key, value] of Object.entries(responseHeaders)) {
    attributes[`http.response.header.${key}`] = value;
  }

  return attributes;
}
