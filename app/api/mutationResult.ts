/** HTTP 2xx alone is not a confirmed PDS write. */
export function requireMutationSuccess<T>(body: T): T {
  if (!body || typeof body !== "object" || !("success" in body) || body.success !== true) {
    const message = body && typeof body === "object" && "message" in body ? body.message : null;
    throw new Error(typeof message === "string" ? message : "The change could not be saved.");
  }
  return body;
}
