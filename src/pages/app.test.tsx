import { expect, test } from "bun:test";
import { Hono } from "hono";
import { AppPage } from "./app";

async function render() {
  const app = new Hono();
  app.get("/app", (c) => c.html(<AppPage />));
  return (await app.request("/app")).text();
}

test("app landing describes the four tabs and separates public records from private ebooks", async () => {
  const html = await render();
  for (const text of [
    "Home",
    "My Books",
    "Discover",
    "Profile",
    "OPDS",
    "KOSync",
    "KOReader",
    "AT Protocol",
    "half-star",
    "previous reads",
    "Goodreads",
    "Hardcover",
  ]) {
    expect(html).toContain(text);
  }
  expect(html).toContain("They are not published to your AT Protocol repository.");
  expect(html).toContain("BookHive does not include an in-app ebook reader.");
  expect(html).not.toContain("Personalized search and recommendations");
  expect(html).not.toContain("Google Play");
  expect(html.match(/<h1\b/g)).toHaveLength(1);
});

test("app landing preserves the App Store destination and accessible no-JS disclosures", async () => {
  const html = await render();
  expect(
    html.match(
      /href="https:\/\/apps.apple.com\/us\/app\/bookhive-a-better-goodreads\/id6749799032"/g,
    ),
  ).toHaveLength(2);
  expect(html.match(/<details\b/g)).toHaveLength(3);
  expect(html.match(/<summary\b/g)).toHaveLength(3);
  expect(html).toContain('href="#inside-the-app"');
  expect(html).toContain('id="inside-the-app"');
});

test("all seven genuine screenshots have WebP sources, PNG fallbacks and matching dimensions", async () => {
  const html = await render();
  const pictures = [...html.matchAll(/<picture>(.*?)<\/picture>/g)];
  expect(pictures).toHaveLength(7);
  let webpBytes = 0;
  for (const [, picture] of pictures) {
    const image = picture!.match(
      /src="(\/screenshots\/app\/([\w-]+)\.png)".*?alt="([^"]+)".*?width="(\d+)".*?height="(\d+)"/,
    );
    expect(image).not.toBeNull();
    const [, path, name, alt, width, height] = image!;
    expect(alt!.length).toBeGreaterThan(30);
    expect(picture).toContain(`type="image/webp" srcset="/screenshots/app/${name}.webp"`);
    const png = Bun.file(new URL(`../../public${path}`, import.meta.url));
    const header = new DataView(await png.arrayBuffer());
    expect(header.getUint32(16)).toBe(Number(width));
    expect(header.getUint32(20)).toBe(Number(height));
    const webp = Bun.file(new URL(`../../public/screenshots/app/${name}.webp`, import.meta.url));
    expect(await webp.exists()).toBe(true);
    webpBytes += webp.size;
  }
  expect(webpBytes).toBeLessThan(250_000);
  expect(html).not.toContain("/screenshots/home-screen");
});

test("only the hero screenshot loads eagerly with high priority", async () => {
  const html = await render();
  expect(html.match(/loading="eager"/g)).toHaveLength(1);
  expect(html.match(/fetchpriority="high"/g)).toHaveLength(1);
  expect(html.match(/loading="lazy"/g)).toHaveLength(6);
});
