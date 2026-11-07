import { expect, test } from "bun:test";
import { Hono } from "hono";
import { env } from "../env";
import { Layout } from "./layout";

async function render(image: string, requestUrl?: string) {
  const publicOrigin = new URL(env.PUBLIC_URL);
  const internal = new URL("/profile/tester.resenha.ink?code=secret&state=secret", publicOrigin);
  internal.protocol = publicOrigin.protocol === "https:" ? "http:" : "https:";
  internal.port = publicOrigin.port === "8080" ? "8081" : "8080";
  const app = new Hono();
  app.get("*", (c) =>
    c.html(<Layout url={requestUrl ?? internal.toString()} image={image} assetUrls={null} />),
  );
  return (await app.request("/")).text();
}

test("metadata uses the configured public scheme behind a TLS proxy", async () => {
  const origin = new URL(env.PUBLIC_URL).origin;
  const html = await render("/og/profile/tester.resenha.ink");
  for (const name of ["og:url", "twitter:url"]) {
    expect(html).toContain(`property="${name}" content="${origin}/profile/tester.resenha.ink"`);
  }
  expect(html).toContain(`property="og:image" content="${origin}/og/profile/tester.resenha.ink"`);
  expect(html).toContain(`name="twitter:image" content="${origin}/og/profile/tester.resenha.ink"`);
  expect(html).toContain(`property="og:logo" content="${origin}/icon.svg"`);
  expect(html).toContain(`rel="canonical" href="${origin}/profile/tester.resenha.ink"`);
  expect(html).not.toContain("secret");
});

test("absolute same-site images use the public scheme, external images remain unchanged", async () => {
  const publicOrigin = new URL(env.PUBLIC_URL);
  const image = new URL("/og/profile/tester.resenha.ink", publicOrigin);
  image.protocol = publicOrigin.protocol === "https:" ? "http:" : "https:";
  image.port = publicOrigin.port === "8080" ? "8081" : "8080";
  expect(await render(image.toString())).toContain(
    `content="${publicOrigin.origin}/og/profile/tester.resenha.ink"`,
  );
  expect(await render("http://external.invalid/cover.jpg")).toContain(
    'content="http://external.invalid/cover.jpg"',
  );
});

test("distinct request/PDS origins retain their scheme and port while stripping OAuth secrets", async () => {
  const origin = "http://pds.example.test:8088";
  const html = await render(
    "/cover.jpg",
    `${origin}/account?code=secret&state=secret&redirect_uri=secret&iss=secret&error=secret&error_description=secret&keep=yes`,
  );
  expect(html).toContain(`rel="canonical" href="${origin}/account?keep=yes"`);
  expect(html).toContain(`property="og:image" content="${origin}/cover.jpg"`);
  expect(html).toContain(`property="og:logo" content="${origin}/icon.svg"`);
  expect(html).toContain(`"url": "${origin}"`);
  expect(html).not.toContain("secret");
});
