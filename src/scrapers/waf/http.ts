/// HTTP bits shared by the main-thread page fetch (`solver.ts`) and the solver
/// worker (`solver-worker.ts`).
///
/// These live together because the User-Agent the page fetch sends and the
/// fingerprint `buildSignals(ua)` encrypts must describe the *same* browser. When
/// each side had its own copy of the constant, a change to one silently made the
/// two disagree, which is exactly the sort of mismatch AWS WAF scores against us.

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const BRANDS: Record<number, string> = {
  0: '"Not/A)Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"',
  1: '"Not A(Brand";v="24", "Chromium";v="{v}", "Google Chrome";v="{v}"',
  2: '"Chromium";v="{v}", "Not(A:Brand";v="24", "Google Chrome";v="{v}"',
  3: '"Not:A-Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"',
};

export function parseUA(ua: string): { brand: string; platform: string; ver: string } {
  const m = ua.match(/Chrome\/(\d+)/);
  const ver = m?.[1] ?? "137";
  const platform = ua.toLowerCase().includes("windows")
    ? "Windows"
    : ua.toLowerCase().includes("mac")
      ? "macOS"
      : "Linux";
  const brand = BRANDS[parseInt(ver) % 4]!.replace(/\{v\}/g, ver);
  return { brand, platform, ver };
}

/** Headers for a top-level document request — what a browser sends when you
 *  type the URL in. */
export function navHeaders(ua: string): Record<string, string> {
  const { brand, platform } = parseUA(ua);
  return {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua": brand,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${platform}"`,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": ua,
  };
}

/** Headers for the XHR-ish calls the challenge script makes. */
export function apiHeaders(site: string, ua: string, sameOrigin: boolean): Record<string, string> {
  const { brand, platform } = parseUA(ua);
  return {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    origin: site,
    pragma: "no-cache",
    priority: "u=1, i",
    referer: `${site}/`,
    "sec-ch-ua": brand,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${platform}"`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": sameOrigin ? "same-origin" : "cross-site",
    "user-agent": ua,
  };
}

/** Page bodies we're willing to buffer. A WAF interstitial or error page is
 *  small; anything huge is a bug or an attack, and buffering it 4,000× is how
 *  the 2026-08-01 OOM happened. */
export const MAX_PAGE_BYTES = 3_000_000;
/** challenge.js is ~1.3 MB (see README) — leave real headroom. */
export const MAX_CHALLENGE_SCRIPT_BYTES = 4_000_000;

/**
 * `resp.text()` with a hard byte ceiling. Streams so an oversized body is never
 * fully materialized, and cancels the underlying connection on trip.
 */
export async function boundedText(
  resp: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  const declared = Number(resp.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await resp.body?.cancel();
    throw new Error(`${label} body too large: ${declared} > ${maxBytes} bytes`);
  }

  if (!resp.body) return "";

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`${label} body too large: exceeded ${maxBytes} bytes`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}
