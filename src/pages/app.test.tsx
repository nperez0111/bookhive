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
  expect(html).not.toContain("app-eyebrow");
  expect(html).toContain("A little more buzz.");
  expect(html).toContain("A lot more books.");
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

test("both theme variants have genuine WebP sources, PNG fallbacks and matching dimensions", async () => {
  const html = await render();
  const pictures = [...html.matchAll(/<picture\b[^>]*>(.*?)<\/picture>/g)];
  expect(pictures).toHaveLength(14);
  expect(html.match(/class="app-screenshot-light"/g)).toHaveLength(7);
  expect(html.match(/class="app-screenshot-dark"/g)).toHaveLength(7);
  let webpBytes = 0;
  for (const [, picture] of pictures) {
    const image = picture!.match(
      /src="(\/screenshots\/app\/([\w-]+-20261117)\.png)".*?alt="([^"]+)".*?width="(\d+)".*?height="(\d+)"/,
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
  expect(webpBytes).toBeLessThan(500_000);
  expect(html).not.toContain("/screenshots/home-screen");
});

test("only the hero screenshot loads eagerly with high priority", async () => {
  const html = await render();
  expect(html.match(/loading="eager"/g)).toHaveLength(2);
  expect(html.match(/fetchpriority="high"/g)).toHaveLength(2);
  expect(html.match(/loading="lazy"/g)).toHaveLength(12);
});

test("the editorial landing owns its landmarks, anchor navigation and shared theme control", async () => {
  const html = await render();
  expect(html.match(/<header\b/g)).toHaveLength(1);
  expect(html.match(/<main\b/g)).toHaveLength(1);
  expect(html).toContain('aria-label="App overview"');
  expect(html).not.toContain('href="#on-ipad"');
  expect(html.match(/href="#inside-the-app"/g)).toHaveLength(1);
  expect(html).toContain('id="on-ipad"');
  expect(html).toContain('aria-label="Toggle dark mode"');
  expect(html).toContain("localStorage.setItem");
  const css = html.match(/<style>(.*?)<\/style>/s)?.[1];
  expect(css).toContain(".dark .app-site");
  expect(css).toContain(".app-landing > section + section");
  expect(css).not.toContain("&gt;");
  expect(css).not.toContain("@import");
  expect(css).toContain("prefers-reduced-motion");
});
