import { join } from "path";
import { env } from "../env";

export type BundleAssetUrls = { css: string[]; js: string[] };

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
  for (const dir of ["public", "dist/public"]) {
    const absPath = join(cwd, dir, ".vite", "manifest.json");
    const file = Bun.file(absPath);
    if (await file.exists()) {
      cachedProductionPublicRoot = dir;
      return dir;
    }
  }
  return "dist/public";
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
      join(cwd, "dist", "public", ".vite", "manifest.json"),
    ];

    let manifestFile: string | null = null;
    for (const absPath of possiblePaths) {
      try {
        const file = Bun.file(absPath);
        if (await file.exists()) {
          manifestFile = await file.text();
          cachedProductionPublicRoot = absPath.includes("/dist/public/")
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
export function getAssetUrlsFromManifest(
  manifest: ViteManifest | null,
): BundleAssetUrls {
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
