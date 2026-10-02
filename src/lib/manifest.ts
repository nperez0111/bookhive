import { join } from "path";
import { env } from "../env";

export type BundleAssetUrls = { css: string[]; js: string[]; inlineCss?: string };

export interface ViteManifestEntry {
  file: string;
  css?: string[];
  assets?: string[];
}

export interface ViteManifest {
  [key: string]: ViteManifestEntry;
}

let cachedManifest: ViteManifest | null = null;
/** Set when manifest is loaded; used so app can serve from same root (Docker: cwd is dist → public/; local prod: dist/public/). */
let cachedProductionPublicRoot: string | null = null;

/**
 * Resolve production public root: directory that contains .vite/manifest.json and built assets.
 * - When running from repo root: dist/public/
 * - When running from dist/ (e.g. Docker `cd dist && bun index.js`): public/
 */
export async function resolveProductionPublicRoot(): Promise<string> {
  if (cachedProductionPublicRoot) return cachedProductionPublicRoot;
  const cwd = process.cwd();
  for (const dir of ["public", ".output/public", "dist/public"]) {
    const absPath = join(cwd, dir, ".vite", "manifest.json");
    const file = Bun.file(absPath);
    if (await file.exists()) {
      cachedProductionPublicRoot = dir;
      return dir;
    }
  }
  return ".output/public";
}

/**
 * Load Vite's manifest.json in production.
 * In development, returns null (asset URLs are provided by getAssetUrlsFromManifest).
 */
export async function loadViteManifest(): Promise<ViteManifest | null> {
  if (env.NODE_ENV !== "production") return null;
  if (cachedManifest) return cachedManifest;

  try {
    const cwd = process.cwd();
    const possiblePaths = [
      join(cwd, "public", ".vite", "manifest.json"),
      join(cwd, ".output", "public", ".vite", "manifest.json"),
      join(cwd, "dist", "public", ".vite", "manifest.json"),
    ];

    let manifestFile: string | null = null;
    for (const absPath of possiblePaths) {
      try {
        const file = Bun.file(absPath);
        if (await file.exists()) {
          manifestFile = await file.text();
          cachedProductionPublicRoot = absPath.includes("/.output/public/")
            ? ".output/public"
            : absPath.includes("/dist/public/")
              ? "dist/public"
              : "public";
          break;
        }
      } catch {
        // Try next path
      }
    }

    cachedManifest = manifestFile ? JSON.parse(manifestFile) : null;
    return cachedManifest;
  } catch (error) {
    console.error("Failed to load Vite manifest:", error);
    return null;
  }
}

/**
 * Get asset URLs from Vite manifest for production.
 * In development, returns Vite dev server URLs (manifest is null).
 */
export function getAssetUrlsFromManifest(manifest: ViteManifest | null): BundleAssetUrls {
  if (!manifest) {
    if (env.NODE_ENV !== "production") {
      // Dev mode: Vite serves CSS from client entry at port 5173
      // The CSS is imported in src/client/index.tsx, so Vite will inject it
      return {
        css: [], // CSS is injected by Vite HMR, not as separate link tag
        js: ["/src/client/index.tsx"], // Vite serves this directly
      };
    }

    // Production fallback (shouldn't happen if manifest loads correctly)
    return {
      css: ["/assets/style.css"],
      js: ["/assets/client-DboRkUmU.js"],
    };
  }

  const css: string[] = [];
  const js: string[] = [];

  // Collect JS and CSS files from client entry
  const clientEntry = manifest["src/client/index.tsx"];
  if (clientEntry?.file) {
    // File path already includes "assets/" prefix from Vite
    js.push(`/${clientEntry.file}`);
  }

  // CSS files are listed in the client entry's css array
  // (Vite automatically detects CSS imports in modules)
  if (clientEntry?.css?.length) {
    css.push(...clientEntry.css.map((cssFile) => `/${cssFile}`));
  }

  return { css, js };
}

/** Cached inlined CSS content (production only). Keyed by the css file paths. */
let cachedInlineCss: { key: string; value: string } | null = null;

/**
 * Read the built CSS files from disk and concatenate their contents so they can
 * be inlined into the HTML `<head>` as a `<style>` tag. This removes the
 * render-blocking `<link rel="stylesheet">` network request from the critical
 * path (improves FCP/LCP). Result is cached for the process lifetime since the
 * hashed filenames are immutable per build.
 *
 * Returns `undefined` in development (Vite injects CSS via HMR) or if reading fails.
 */
export async function getInlineCss(assetUrls: BundleAssetUrls): Promise<string | undefined> {
  if (env.NODE_ENV !== "production") return undefined;
  if (!assetUrls.css.length) return undefined;

  const key = assetUrls.css.join("|");
  if (cachedInlineCss?.key === key) return cachedInlineCss.value;

  try {
    const publicRoot = await resolveProductionPublicRoot();
    const cwd = process.cwd();
    const contents: string[] = [];
    for (const href of assetUrls.css) {
      // href is like "/assets/client-XXXX.css"; strip leading slash and join under public root.
      const rel = href.replace(/^\//, "");
      const absPath = join(cwd, publicRoot, rel);
      const file = Bun.file(absPath);
      if (await file.exists()) {
        contents.push(await file.text());
      } else {
        // Missing file → bail out and fall back to <link> so styles are never lost.
        return undefined;
      }
    }
    const value = contents.join("\n");
    cachedInlineCss = { key, value };
    return value;
  } catch (error) {
    console.error("Failed to inline CSS:", error);
    return undefined;
  }
}
