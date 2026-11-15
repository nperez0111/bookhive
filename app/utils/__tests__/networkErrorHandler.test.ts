import { classifyNetworkError, shouldRetryQuery } from "../networkErrorHandler";

it.each([
  {
    name: "FetchError",
    message:
      '[GET] "http://127.0.0.1:5199/private": <no response> fetch failed: Could not connect to the server.',
  },
  { name: "FetchError", message: "Request failed", cause: new TypeError("fetch failed") },
])("presents native transport failures without exposing request URLs: %p", (error) => {
  expect(classifyNetworkError(error)).toEqual({
    type: "network",
    message: "Unable to connect to the server. Please check your internet connection.",
    retryable: true,
  });
  expect(shouldRetryQuery(0, error)).toBe(true);
  expect(shouldRetryQuery(3, error)).toBe(false);
});

it.each([
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "not_found"],
  [503, "server"],
] as const)("keeps HTTP %s authoritative over nested transport prose", (status, type) => {
  for (const name of ["FetchError", "TypeError"]) {
    expect(classifyNetworkError({ name, status, message: "fetch failed" })).toMatchObject({
      type,
      statusCode: status,
    });
  }
});

it("never retries session cancellation wrapped by a fetch failure", () => {
  const cause = Object.assign(new Error("Authentication session changed"), { name: "AbortError" });
  expect(shouldRetryQuery(0, { name: "FetchError", message: "fetch failed", cause })).toBe(false);
});
