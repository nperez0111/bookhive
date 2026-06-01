/**
 * imgproxy signing + URL helpers.
 *
 * Our public, canonical image endpoint is `/images/{modifiers}/{source}` on our
 * own domain. That route is a thin signing reverse-proxy: it validates the
 * source host, translates the IPX-style modifier string into imgproxy
 * processing options, signs the imgproxy URL server-side, and streams the
 * result back. Keeping the signing here (server-side) means clients and the iOS
 * app never see the signing key, and the canonical `/images/...` URLs stay
 * stable even if the underlying provider changes.
 */
import { env } from "../env";

/** Remote hosts we are willing to proxy. */
export const ALLOWED_IMAGE_HOSTS = new Set(["i.gr-assets.com", "cdn.bsky.app"]);

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
 * Parse a `/images/*` request pathname into its modifier segment and source id.
 *
 * The canonical grammar is `/images/{modifiers}/{source}` where `{source}` is a
 * full `https://...` URL. Two wrinkles are handled here:
 *  - Joining the remaining segments preserves the `//` in `https://host`
 *    (`["https:", "", "host"]` => `https://host`).
 *  - Browsers/proxies collapse the `//` after the protocol to a single `/`
 *    (e.g. `https:/cdn.bsky.app`), so we restore it before returning the source.
 *
 * `pathname` is the full request path (e.g. `/images/w_440/https://...`).
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

  // extend: IPX `extend_T_R_B_L` -> imgproxy `ex:1` (extend to requested size).
  // imgproxy doesn't take per-side extend the same way; enabling extend is the
  // meaningful translation so `fill` results are padded to the exact box.
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

  const format = modifiers["f"] || modifiers["format"];
  if (format) {
    opts.push(`f:${format === "jpg" ? "jpeg" : format}`);
  }

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
  // Path is everything after the signature slot, including the leading slash.
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

// --- Canonical builders (public `/images/...` URLs for web <img>) ---

/** Build a canonical cover image URL on our own domain. */
export function coverImageUrl(
  source: string | null | undefined,
  opts: { width: number; origin?: string } = { width: 440 },
): string | undefined {
  if (!source) return undefined;
  const path = `/images/w_${opts.width}/${source}`;
  return opts.origin ? `${opts.origin}${path}` : path;
}

/** Build a canonical avatar image URL on our own domain. */
export function avatarImageUrl(
  source: string | null | undefined,
  opts: { size: number; origin?: string } = { size: 120 },
): string | undefined {
  if (!source) return undefined;
  const path = `/images/s_${opts.size}x${opts.size},fit_cover/${source}`;
  return opts.origin ? `${opts.origin}${path}` : path;
}
