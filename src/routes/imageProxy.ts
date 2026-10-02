/**
 * imgproxy signing + URL helpers.
 *
 * `/images/{modifiers}/{source}` is a thin signing reverse-proxy: validates the
 * source host, translates IPX-style modifiers into imgproxy options, signs the
 * URL server-side (so clients/iOS never see the signing key), and streams the
 * result back.
 */
import { env } from "../env";
import { errorMessage } from "../lib/errors";

/** Remote hosts we are willing to proxy. */
// images.isbndb.com stays allowlisted even though that scraper is no longer wired up — old rows still carry those cover URLs.
export const ALLOWED_IMAGE_HOSTS = new Set([
  "i.gr-assets.com",
  "cdn.bsky.app",
  "images.isbndb.com",
]);

/** Parsed IPX-style modifiers, e.g. { w: "440" } or { s: "300x500", fit: "cover" }. */
export type ImageModifiers = Record<string, string>;

/**
 * Parse an IPX-style modifier segment (e.g. `s_300x500,fit_cover,extend_5_5_5_5,b_030712`)
 * into a key/value map. A literal `_` means "no modifiers".
 */
export function parseModifiers(modifiersString: string): ImageModifiers {
  const modifiers: ImageModifiers = Object.create(null);
  if (!modifiersString || modifiersString === "_") return modifiers;
  for (const part of modifiersString.split(/[&,]/g)) {
    const [key, ...values] = part.split("_");
    if (key) modifiers[key] = values.join("_");
  }
  return modifiers;
}

/**
 * Parse a `/images/*` request pathname (e.g. `/images/w_440/https://...`) into
 * its modifier segment and source id. Two wrinkles handled here:
 *  - Joining the remaining segments preserves the `//` in `https://host`.
 *  - Browsers/proxies collapse the `//` after the protocol to a single `/`
 *    (e.g. `https:/cdn.bsky.app`), so we restore it before returning the source.
 */
export function parseImagePath(pathname: string): { modifiersString: string; id: string } {
  const imagePath = pathname.replace(/^\/images/, "") || "/";
  const [modifiersString = "_", ...idSegments] = imagePath.slice(1).split("/");
  const id = decodeURIComponent(idSegments.join("/")).replace(/^(https?:)\/(?!\/)/i, "$1//");
  return { modifiersString, id };
}

/**
 * Translate our IPX-style modifier map into an imgproxy processing-options
 * string (slash-separated, colon-args). Supports the modifiers our web/OG/iOS
 * clients actually emit: width/height (`w`/`h`), size (`s`/`resize` as `WxH`),
 * `fit_cover`, `extend_*`, background (`b_`), format (`f`/`format`),
 * quality (`q`/`quality`).
 */
export function modifiersToImgproxyOptions(modifiers: ImageModifiers): string {
  const opts: string[] = [];

  const width = modifiers["w"] || modifiers["width"];
  const height = modifiers["h"] || modifiers["height"];
  const size = modifiers["s"] || modifiers["resize"];
  const fit = modifiers["fit"];

  // Resizing type: imgproxy `fill` ≈ IPX `cover`, otherwise `fit`.
  const resizingType = fit === "cover" ? "fill" : "fit";

  if (size) {
    // "WxH" e.g. 300x500
    const [sw = "", sh = ""] = size.split("x");
    if (sw || sh) {
      opts.push(`rs:${resizingType}:${Number(sw) || 0}:${Number(sh) || 0}:0`);
    }
  } else if (width || height) {
    opts.push(`rs:${resizingType}:${Number(width) || 0}:${Number(height) || 0}:0`);
  }

  // imgproxy has no per-side extend, so IPX `extend_T_R_B_L` maps to plain `ex:1`.
  if (modifiers["extend"]) {
    opts.push("ex:1");
  }

  // background color: IPX `b_030712` (hex without #) -> imgproxy `bg:030712`.
  const bg = modifiers["b"] || modifiers["bg"] || modifiers["background"];
  if (bg) {
    opts.push(`bg:${bg}`);
  }

  const quality = modifiers["q"] || modifiers["quality"];
  if (quality && Number(quality)) {
    opts.push(`q:${Number(quality)}`);
  }

  // Default to WebP, forced into the URL rather than negotiated via Accept —
  // responses are edge-cached by URL, so header-based negotiation would poison the cache.
  const format = modifiers["f"] || modifiers["format"] || "webp";
  opts.push(`f:${format === "jpg" ? "jpeg" : format}`);

  return opts.join("/");
}

/** URL-safe base64 without padding. */
function urlSafeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Signing/base config for imgproxy. Defaults to values from `env`. */
export type ImgproxyConfig = {
  baseUrl: string;
  key: string;
  salt: string;
};

function configFromEnv(): ImgproxyConfig {
  return { baseUrl: env.IMGPROXY_URL, key: env.IMGPROXY_KEY, salt: env.IMGPROXY_SALT };
}

/**
 * Sign an imgproxy path (everything after the signature slot, including the
 * leading `/`). Returns the signature or `"insecure"` when signing is disabled.
 *
 * signature = urlsafe_base64( HMAC_SHA256( key, salt_bytes + path_bytes ) )
 *
 * `key`/`salt` are hex-encoded (imgproxy convention).
 */
export function signImgproxyPath(
  path: string,
  config: Pick<ImgproxyConfig, "key" | "salt"> = configFromEnv(),
): string {
  if (!config.key || !config.salt) return "insecure";
  const key = Buffer.from(config.key, "hex");
  const salt = Buffer.from(config.salt, "hex");
  const message = Buffer.concat([salt, Buffer.from(path, "utf8")]);
  const digest = new Bun.CryptoHasher("sha256", key).update(message).digest();
  return urlSafeBase64(new Uint8Array(digest));
}

/**
 * Build a fully-signed imgproxy URL for a remote source.
 * Uses the base64-encoded-source form: `/{sig}/{options}/{b64src}`.
 */
export function buildImgproxyUrl(
  source: string,
  modifiers: ImageModifiers,
  config: ImgproxyConfig = configFromEnv(),
): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  const options = modifiersToImgproxyOptions(modifiers);
  const b64Source = urlSafeBase64(Buffer.from(source, "utf8"));
  const path = `/${options ? options + "/" : ""}${b64Source}`;
  const signature = signImgproxyPath(path, config);
  return `${base}/${signature}${path}`;
}

/** True when a source is a remote http(s) URL on the allowlist. */
export function isAllowedImageSource(source: string): boolean {
  if (!/^https?:\/\//i.test(source)) return false;
  try {
    return ALLOWED_IMAGE_HOSTS.has(new URL(source).hostname);
  } catch {
    return false;
  }
}

/** Public cache lifetime for proxied images (Cloudflare edge + browser). */
export const IMAGE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Ceiling on the imgproxy round-trip before we serve the placeholder. */
const IMGPROXY_TIMEOUT_MS = 10_000;

/** An SVG placeholder — user silhouette for avatars, book card otherwise. */
export function fallbackImageSvg(kind: "avatar" | "book"): string {
  return kind === "avatar"
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
        <rect width="100" height="100" fill="#fef3c7"/>
        <circle cx="50" cy="38" r="18" fill="#d97706"/>
        <path d="M14 85c0-19.9 16.1-36 36-36s36 16.1 36 36" fill="#d97706"/>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" fill="none">
        <rect width="100" height="140" rx="4" fill="#fef3c7"/>
        <rect x="20" y="30" width="60" height="6" rx="3" fill="#d97706" opacity=".5"/>
        <rect x="20" y="46" width="45" height="6" rx="3" fill="#d97706" opacity=".35"/>
        <rect x="20" y="62" width="52" height="6" rx="3" fill="#d97706" opacity=".35"/>
      </svg>`;
}

/** Build an SVG-fallback `Response` (used when a source is forbidden/fails). */
export function svgFallbackResponse(kind: "avatar" | "book", requestId: string): Response {
  return new Response(fallbackImageSvg(kind), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=60",
      "X-Request-Id": requestId,
    },
  });
}

export type ProxyImageOptions = {
  /** Resolved source URL (must be on the allowlist). */
  source: string | null | undefined;
  /** IPX-style modifiers to apply. */
  modifiers: ImageModifiers;
  /** Which placeholder to render on failure/forbidden source. */
  kind: "avatar" | "book";
  /** Incoming `If-None-Match` header, forwarded for 304 support. */
  ifNoneMatch?: string;
  /** Request id echoed back on responses. */
  requestId: string;
  /** Structured warn logger for forbidden/error cases. */
  warn?: (event: { msg: string; image_id?: string; error?: string }) => void;
};

/**
 * Resolve → validate → sign → fetch imgproxy → stream the result back.
 * Shared by the source-embedded `/images/*` route and the ID-keyed
 * `/images/books/:hiveId` & `/images/avatars/:did` routes.
 */
export async function proxyImageResponse(opts: ProxyImageOptions): Promise<Response> {
  const { source, modifiers, kind, ifNoneMatch, requestId, warn } = opts;

  if (!source || !isAllowedImageSource(source)) {
    warn?.({ msg: "image_proxy_forbidden_source", image_id: source ?? undefined });
    return svgFallbackResponse(kind, requestId);
  }

  // No imgproxy configured (e.g. local dev) → redirect to the source.
  if (!env.IMGPROXY_URL) {
    return Response.redirect(source, 302);
  }

  try {
    const imgproxyUrl = buildImgproxyUrl(source, modifiers);
    const upstream = await fetch(imgproxyUrl, {
      headers: ifNoneMatch ? { "If-None-Match": ifNoneMatch } : undefined,
      // Without this an imgproxy stall pins the request indefinitely.
      signal: AbortSignal.timeout(IMGPROXY_TIMEOUT_MS),
    });

    if (upstream.status === 304) {
      return new Response(null, {
        status: 304,
        headers: { ETag: upstream.headers.get("ETag") ?? "", "X-Request-Id": requestId },
      });
    }

    if (!upstream.ok || !upstream.body) {
      throw new Error(`imgproxy ${upstream.status}`);
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "image/jpeg");
    headers.set("Cache-Control", `public, max-age=${IMAGE_MAX_AGE}`);
    const etag = upstream.headers.get("ETag");
    if (etag) headers.set("ETag", etag);
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("X-Request-Id", requestId);

    return new Response(upstream.body, { headers });
  } catch (err) {
    const message = errorMessage(err);
    warn?.({ msg: "image_proxy_error", image_id: source, error: message });
    return svgFallbackResponse(kind, requestId);
  }
}

// --- Canonical builders (public `/images/...` URLs for web <img>) ---
//
// Two stable URL shapes:
//  1. ID-keyed (preferred): /images/books/{hiveId}?w=440, /images/avatars/{did}?s=120
//     — resolved server-side at request time, so the URL is stable and never leaks the upstream provider URL.
//  2. Source-embedded (OG render + iOS, non-catalog images): /images/w_440/{sourceUrl}
//     — stateless, but the URL changes if the source does.
//
// `coverImageUrl`/`avatarImageUrl` emit shape (1) when given an id, falling back
// to shape (2) for a raw source URL (used by OG/iOS via `sourceCoverImageUrl`).

/**
 * Translate `?w=`/`?h=`/`?s=`/`?q=`/`?fit=` query params (used by the ID-keyed
 * canonical routes) into our IPX-style modifier map. `defaults` supplies the
 * modifiers to use when no sizing query is present.
 */
export function queryToModifiers(
  query: Record<string, string | undefined>,
  defaults: ImageModifiers = {},
): ImageModifiers {
  const modifiers: ImageModifiers = { ...defaults };
  if (query["w"]) modifiers["w"] = query["w"];
  if (query["h"]) modifiers["h"] = query["h"];
  if (query["s"]) modifiers["s"] = query["s"];
  if (query["q"]) modifiers["q"] = query["q"];
  if (query["fit"]) modifiers["fit"] = query["fit"];
  return modifiers;
}
