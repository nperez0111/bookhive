/**
 * **The one** place a `/images/...` URL is spelled.
 *
 * Split out of `imageProxy.ts` because thirteen of that module's fourteen
 * importers are page components that want only these four functions — and
 * importing them dragged in `node:crypto`, the imgproxy signing key and the
 * `Response`-building proxy handler, none of which a template has any business
 * touching. The fourteenth is the proxy route itself, which is where the rest
 * now lives (`src/routes/imageProxy.ts`), next to its only caller.
 *
 * Two URL shapes, and the choice between them is not cosmetic:
 *
 * - **ID-keyed** (`coverImageUrl`, `avatarImageUrl`) is canonical and
 *   preferred. The route resolves the current cover or avatar for that id at
 *   request time, so the URL stays valid when the source changes.
 * - **Source-embedded** (`sourceCoverImageUrl`, `sourceAvatarImageUrl`) is
 *   stateless, for the callers that have no stable id to key on — the OG
 *   renderer and the iOS app.
 */

/**
 * Build a canonical, ID-keyed cover image URL: `/images/books/{hiveId}?w={n}`.
 * The route resolves the current cover source for the book at request time.
 */
export function coverImageUrl(
  hiveId: string | null | undefined,
  opts: { width?: number; origin?: string } = {},
): string | undefined {
  if (!hiveId) return undefined;
  const query = opts.width ? `?w=${opts.width}` : "";
  const path = `/images/books/${encodeURIComponent(hiveId)}${query}`;
  return opts.origin ? `${opts.origin}${path}` : path;
}

/**
 * Build a canonical, ID-keyed avatar URL: `/images/avatars/{did}?s={n}`.
 * The route resolves the profile's current avatar at request time.
 */
export function avatarImageUrl(
  did: string | null | undefined,
  opts: { size?: number; origin?: string } = {},
): string | undefined {
  if (!did) return undefined;
  const query = opts.size ? `?s=${opts.size}` : "";
  const path = `/images/avatars/${encodeURIComponent(did)}${query}`;
  return opts.origin ? `${opts.origin}${path}` : path;
}

/**
 * Build a source-embedded cover URL: `/images/w_{n}/{sourceUrl}`.
 * Used where there is no stable id to key on (OG render, iOS) — stateless.
 */
export function sourceCoverImageUrl(
  source: string | null | undefined,
  opts: { width: number; origin?: string } = { width: 440 },
): string | undefined {
  if (!source) return undefined;
  const path = `/images/w_${opts.width}/${source}`;
  return opts.origin ? `${opts.origin}${path}` : path;
}

/**
 * Build a source-embedded avatar URL: `/images/s_{n}x{n},fit_cover/{sourceUrl}`.
 * Used where there is no stable id to key on (OG render, iOS) — stateless.
 */
export function sourceAvatarImageUrl(
  source: string | null | undefined,
  opts: { size: number; origin?: string } = { size: 120 },
): string | undefined {
  if (!source) return undefined;
  const path = `/images/s_${opts.size}x${opts.size},fit_cover/${source}`;
  return opts.origin ? `${opts.origin}${path}` : path;
}
