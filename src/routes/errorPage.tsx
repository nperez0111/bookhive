import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AppEnv } from "../context";
import { Error as ErrorPage } from "../pages/error";

/**
 * **The one** "render an error page with the matching HTTP status".
 *
 * `ErrorPage`'s `statusCode` prop is display-only (`src/pages/error.tsx`
 * renders it as a `<p>`), so a route that passes it without also calling
 * `c.status()` serves a page that says "404" with a 200 OK status line.
 * Taking one number and using it for both prevents that drift.
 */
export function renderError(
  c: Context<AppEnv>,
  {
    status,
    message,
    description,
    title,
  }: {
    status: ContentfulStatusCode;
    message: string;
    description?: string;
    /** `<title>`; defaults to the message. */
    title?: string;
  },
): Response {
  c.status(status);
  return c.render(<ErrorPage message={message} description={description} statusCode={status} />, {
    title: title ?? message,
  });
}
