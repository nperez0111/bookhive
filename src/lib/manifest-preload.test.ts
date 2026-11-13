import { expect, test } from "bun:test";
import { getAssetPreloadLinks } from "./manifest";

test("preloads shared scripts with module-compatible CORS and skips inlined CSS", () => {
  expect(
    getAssetPreloadLinks({
      js: ["/assets/client-123.js"],
      css: ["/assets/style.css"],
      inlineCss: "body{}",
    }),
  ).toBe("</assets/client-123.js>; rel=preload; as=script; crossorigin");
});

test("stylesheet fallback is hinted and duplicate assets are removed", () => {
  expect(
    getAssetPreloadLinks({
      js: ["/assets/client.js", "/assets/client.js"],
      css: ["/assets/style.css"],
    }),
  ).toBe(
    "</assets/client.js>; rel=preload; as=script; crossorigin, </assets/style.css>; rel=preload; as=style",
  );
});

test("never advertises dev, external, query-dependent or header-unsafe URLs", () => {
  expect(
    getAssetPreloadLinks({
      js: [
        "/src/client.tsx",
        "//evil.test/a.js",
        "https://evil.test/a.js",
        "/assets/a.js?user=1",
        "/assets/../private.js",
        "/assets/a.js>; rel=preconnect",
      ],
      css: [],
    }),
  ).toBe("");
});
