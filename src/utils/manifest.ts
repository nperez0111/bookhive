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

/**
 * Load Vite's manifest.json in production.
 * In development, returns null (asset URLs are provided by getAssetUrlsFromManifest).
 */
export async function loadViteManifest(): Promise<ViteManifest | null> {
  if (process.env.NODE_ENV !== "production") {
    // In dev mode, we don't use the manifest - assets are served by Vite directly
    return null;
  }

  if (cachedManifest) {
    return cachedManifest;
  }

  try {
    // In production, manifest is at dist/public/.vite/manifest.json
    const manifestFile = await Bun.file(
      "dist/public/.vite/manifest.json",
    ).text();
    cachedManifest = JSON.parse(manifestFile);
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
  // In development, manifest is null - Vite serves assets directly
  if (!manifest) {
    if (process.env.NODE_ENV !== "production") {
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
