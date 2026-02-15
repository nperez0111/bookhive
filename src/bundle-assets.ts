import { env } from "./env";

export type BundleAssetUrls = { css: string[]; js: string[] };
type Cached = { urls: BundleAssetUrls; at: number };

let cache: Cached | null = null;
const CACHE_TTL_MS = env.isDevelopment ? 2000 : Number.POSITIVE_INFINITY;

export async function getBundleAssetUrls(): Promise<BundleAssetUrls> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.urls;
  }
  try {
    const base = `http://127.0.0.1:${env.PORT}`;
    const res = await fetch(`${base}/_bundle`);
    if (!res.ok) return { css: [], js: [] };
    const html = await res.text();
    const css: string[] = [];
    const js: string[] = [];
    for (const link of html.matchAll(/<link[^>]+>/gi)) {
      const tag = link[0];
      if (!/rel=["']stylesheet["']/i.test(tag)) continue;
      const hrefM = tag.match(/href=["']([^"']+)["']/i);
      if (hrefM?.[1]) css.push(hrefM[1].startsWith("/") ? hrefM[1] : `/${hrefM[1]}`);
    }
    for (const script of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
      const src = script[1];
      if (src) js.push(src.startsWith("/") ? src : `/${src}`);
    }
    const urls = { css, js };
    cache = { urls, at: now };
    return urls;
  } catch {
    return { css: [], js: [] };
  }
}
