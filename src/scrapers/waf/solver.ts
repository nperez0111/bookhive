import { createCipheriv, randomBytes, createHash, scryptSync } from "crypto";
import { extractConfig } from "./extract-config";

// ─── CRC32 ──────────────────────────────────────────────────────────────────

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  crc32Table[i] = crc;
}

function crc32(str: string): number {
  const buf = new TextEncoder().encode(str);
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface CryptoConfig {
  key: Buffer;
  keyHex: string;
  identifier: string;
  signalVersion: string;
  challengeBaseUrl: string;
}

interface WafToken {
  value: string;
  obtainedAt: number;
}

// ─── In-memory cache ────────────────────────────────────────────────────────

let cachedConfig: CryptoConfig | null = null;
let cachedToken: WafToken | null = null;
let cachedChallengeJsUrl: string | null = null;

const TOKEN_MAX_AGE_MS = 10 * 60 * 1000;

// ─── Constants ──────────────────────────────────────────────────────────────

const RE_CHAL_SRC = /src="(https:\/\/[^"]+)\/challenge\.js[^"]*"/;
const RE_GOKU = /window\.gokuProps\s*=\s*(\{[^}]+\})/;

const ENDPOINT: Record<string, string> = {
  HashcashScrypt: "verify",
  SHA256: "verify",
  NetworkBandwidth: "mp_verify",
};

const BWDTH_SIZES: Record<number, number> = {
  1: 1024,
  2: 10240,
  3: 102400,
  4: 1048576,
  5: 10485760,
};

const BRANDS: Record<number, string> = {
  0: '"Not/A)Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"',
  1: '"Not A(Brand";v="24", "Chromium";v="{v}", "Google Chrome";v="{v}"',
  2: '"Chromium";v="{v}", "Not(A:Brand";v="24", "Google Chrome";v="{v}"',
  3: '"Not:A-Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"',
};

const GPUS = [
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (Intel)",
    renderer:
      "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (AMD)",
    renderer: "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
];

const SCREENS = [
  [1920, 1080],
  [2560, 1440],
  [1366, 768],
  [1536, 864],
  [1440, 900],
  [1680, 1050],
  [1280, 720],
  [1600, 900],
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// ─── Utility ────────────────────────────────────────────────────────────────

function parseUA(ua: string): { brand: string; platform: string; ver: string } {
  const m = ua.match(/Chrome\/(\d+)/);
  const ver = m?.[1] ?? "137";
  const platform = ua.toLowerCase().includes("windows")
    ? "Windows"
    : ua.toLowerCase().includes("mac")
      ? "macOS"
      : "Linux";
  const brand = BRANDS[parseInt(ver) % 4].replace(/\{v\}/g, ver);
  return { brand, platform, ver };
}

function navHeaders(site: string, ua: string): Record<string, string> {
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

function apiHeaders(site: string, ua: string, sameOrigin: boolean): Record<string, string> {
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

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── AES-256-GCM Encryption ────────────────────────────────────────────────

function encryptSignals(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}::${tag.toString("hex")}::${encrypted.toString("hex")}`;
}

function encodeSignals(obj: Record<string, any>): string {
  const raw = JSON.stringify(obj);
  const crcVal = crc32(raw);
  return `${crcVal.toString(16).toUpperCase().padStart(8, "0")}#${raw}`;
}

// ─── Proof of Work ──────────────────────────────────────────────────────────

function checkZeros(hash: Buffer, difficulty: number): boolean {
  let z = 0;
  for (const b of hash) {
    if (b === 0) {
      z += 8;
    } else {
      for (let i = 7; i >= 0; i--) {
        if ((b & (1 << i)) === 0) z++;
        else break;
      }
      break;
    }
    if (z >= difficulty) break;
  }
  return z >= difficulty;
}

function solveSHA256(challengeInput: string, checksum: string, difficulty: number): string {
  const base = challengeInput + checksum;
  for (let n = 0; n < 100_000_000; n++) {
    const hash = createHash("sha256")
      .update(base + n.toString())
      .digest();
    if (checkZeros(hash, difficulty)) return n.toString();
  }
  return "0";
}

function solveScrypt(
  challengeInput: string,
  checksum: string,
  difficulty: number,
  memory: number,
): string {
  const combined = challengeInput + checksum;
  const salt = Buffer.from(checksum);
  for (let n = 0; n < 100_000_000; n++) {
    const password = Buffer.from(combined + n.toString());
    const hash = scryptSync(password, salt, 16, { N: memory, r: 8, p: 1 });
    if (checkZeros(hash, difficulty)) return n.toString();
  }
  return "0";
}

function solveBandwidth(difficulty: number): string {
  const sz = BWDTH_SIZES[difficulty] ?? 1024;
  return Buffer.alloc(sz, 0).toString("base64");
}

// ─── Extract crypto config ──────────────────────────────────────────────────

async function extractCryptoConfig(
  challengeScript: string,
  challengeBaseUrl: string,
): Promise<CryptoConfig> {
  const parsed = await extractConfig(challengeScript);
  if (!parsed.key) throw new Error("No AES key found in challenge.js");

  const keyBuf = Buffer.from(parsed.key, "hex");
  if (keyBuf.length !== 32) throw new Error(`Expected 32-byte key, got ${keyBuf.length}`);

  return {
    key: keyBuf,
    keyHex: parsed.key,
    identifier: parsed.identifier ?? "Zoey",
    signalVersion: parsed.signalVersion ?? "2.4.0",
    challengeBaseUrl,
  };
}

// ─── Build browser fingerprint signals ──────────────────────────────────────

function buildSignals(site: string, ua: string, sigVersion: string): Record<string, any> {
  const now = Date.now();
  const screen = randChoice(SCREENS);
  const gpu = randChoice(GPUS);
  const hardwareConcurrency = randChoice([4, 8, 12, 16]);
  const deviceMemory = randChoice([4, 8, 8, 16]);
  const dpr = randChoice([1.0, 1.25, 1.5]);

  return {
    version: sigVersion,
    navigator: {
      userAgent: ua,
      appCodeName: "Mozilla",
      appName: "Netscape",
      appVersion: ua.replace("Mozilla/", ""),
      language: "en-US",
      languages: ["en-US", "en"],
      platform: ua.includes("Mac") ? "MacIntel" : "Win32",
      product: "Gecko",
      productSub: "20030107",
      vendor: "Google Inc.",
      vendorSub: "",
      hardwareConcurrency,
      maxTouchPoints: 0,
      cookieEnabled: true,
      onLine: true,
      deviceMemory,
      pdfViewerEnabled: true,
      webdriver: false,
    },
    screen: {
      width: screen[0],
      height: screen[1],
      availWidth: screen[0],
      availHeight: screen[1] - 40,
      colorDepth: 24,
      pixelDepth: 24,
    },
    window: {
      innerWidth: screen[0],
      innerHeight: screen[1] - 117,
      outerWidth: screen[0],
      outerHeight: screen[1],
      devicePixelRatio: dpr,
    },
    tz: { offset: -300, timezone: "America/New_York" },
    time: { start: now - randInt(100, 300), elapsed: randInt(100, 300) },
    canvas: { hash: randomBytes(16).toString("hex") },
    gpu: {
      vendor: gpu.vendor,
      renderer: gpu.renderer,
      extensions: randInt(30, 40),
      viewportWidth: screen[0],
      viewportHeight: screen[1] - 117,
    },
    math: {
      acos: 1.4473588658278522,
      acosh: 709.889355822726,
      asin: 0.12343746096704435,
      asinh: 0.881373587019543,
      atan: 0.4636476090008061,
      atanh: 0.5493061443340549,
      cos: -0.4161468365471424,
      cosh: 1.5430806348152437,
      exp: 2.718281828459045,
      expm1: 1.718281828459045,
      log: 0.6931471805599453,
      sin: 0.8414709848078965,
      sinh: 1.1752011936438014,
      sqrt: 1.4142135623730951,
      tan: -1.5574077246549023,
      tanh: 0.7615941559557649,
    },
    fonts: {
      count: randChoice([42, 48, 55, 63]),
      hash: createHash("sha256")
        .update(`fonts_${screen[0]}_${randInt(0, 9999)}`)
        .digest("hex"),
    },
    plugins: {
      count: 5,
      hash: createHash("sha256")
        .update(
          "PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF",
        )
        .digest("hex"),
    },
    perf: { navigationStart: now - randInt(500, 2500) },
    stealth: {
      webdriver: false,
      phantom: false,
      nightmare: false,
      selenium: false,
      domAutomation: false,
      chromiumBrowser: true,
      languageInconsist: false,
      platformInconsist: false,
      permissions: true,
    },
    batt: {
      charging: true,
      chargingTime: 0,
      dischargingTime: null,
      level: randChoice([0.85, 0.9, 0.95, 1.0]),
    },
    amazonUseragent: ua,
    client: "Browser",
    tVersion: sigVersion,
    id: randomBytes(16).toString("hex"),
    errors: [],
  };
}

function buildMetrics(hasToken: boolean): { metrics: any[]; fpMetrics: Record<string, number> } {
  const collectors = [
    { name: "fp2", mid: "100", lo: 0.5, hi: 3 },
    { name: "browser", mid: "101", lo: 0, hi: 1 },
    { name: "capabilities", mid: "102", lo: 2, hi: 8 },
    { name: "gpu", mid: "103", lo: 3, hi: 12 },
    { name: "dnt", mid: "104", lo: 0, hi: 1 },
    { name: "math", mid: "105", lo: 0, hi: 1 },
    { name: "screen", mid: "106", lo: 0, hi: 1 },
    { name: "navigator", mid: "107", lo: 0, hi: 1 },
    { name: "auto", mid: "108", lo: 0, hi: 1 },
    { name: "stealth", mid: "undefined", lo: 1, hi: 4 },
    { name: "subtle", mid: "110", lo: 0, hi: 1 },
    { name: "canvas", mid: "111", lo: 80, hi: 200 },
    { name: "formdetector", mid: "112", lo: 0, hi: 3 },
    { name: "be", mid: "undefined", lo: 0, hi: 1 },
  ];

  const resolved = collectors.map((c) => ({
    name: c.name,
    mid: c.mid,
    value: +(Math.random() * (c.hi - c.lo) + c.lo).toFixed(1),
  }));

  const fpMetrics: Record<string, number> = {};
  for (const c of resolved) fpMetrics[c.name] = Math.floor(c.value);

  const enc = +(Math.random() * 2.5 + 0.5).toFixed(1);
  const crypt = +(Math.random() * 6 + 2).toFixed(1);
  const coll = resolved.reduce((s, c) => s + c.value, 0);
  const acq = +(coll + enc + crypt + Math.random() * 4 + 2).toFixed(1);
  const chall = +(Math.random() * 6 + 2).toFixed(1);
  const cookie = +(Math.random() * 0.9 + 0.1).toFixed(1);
  const total = +(acq + chall + cookie).toFixed(1);

  const m: any[] = [{ name: "2", value: enc, unit: "2" }];
  for (const c of resolved) {
    m.push({ name: c.mid, value: c.value, unit: "2" });
  }
  m.push(
    { name: "3", value: crypt, unit: "2" },
    { name: "7", value: hasToken ? 1 : 0, unit: "4" },
    { name: "1", value: acq, unit: "2" },
    { name: "4", value: chall, unit: "2" },
    { name: "5", value: cookie, unit: "2" },
    { name: "6", value: total, unit: "2" },
    { name: "8", value: 1, unit: "4" },
  );

  return { metrics: m, fpMetrics };
}

// ─── Discovery ──────────────────────────────────────────────────────────────

async function discover(
  targetUrl: string,
  ua: string,
): Promise<{
  challengeBaseUrl: string;
  sameOrigin: boolean;
  goku: Record<string, any> | null;
}> {
  const site = new URL(targetUrl).origin;
  const resp = await fetch(targetUrl, {
    headers: navHeaders(site, ua),
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const html = await resp.text();

  const srcMatch = html.match(RE_CHAL_SRC);
  if (!srcMatch) {
    throw new Error(`Challenge URL not found (status=${resp.status}, ${html.length} chars)`);
  }

  const gokuMatch = html.match(RE_GOKU);
  return {
    challengeBaseUrl: srcMatch[1],
    sameOrigin: false,
    goku: gokuMatch ? JSON.parse(gokuMatch[1]) : null,
  };
}

// ─── Solve one round ────────────────────────────────────────────────────────

async function solveRound(
  config: CryptoConfig,
  domain: string,
  site: string,
  goku: Record<string, any> | null,
  hasToken: boolean,
  ua: string,
): Promise<string | null> {
  const hdrs = apiHeaders(site, ua, false);

  const signals = buildSignals(site, ua, config.signalVersion);
  const encoded = encodeSignals(signals);
  const checksum = encoded.split("#")[0];
  const encrypted = encryptSignals(encoded, config.key);
  const { metrics } = buildMetrics(hasToken);

  const inputsResp = await fetch(`${config.challengeBaseUrl}/inputs?client=browser`, {
    headers: hdrs,
    signal: AbortSignal.timeout(10_000),
  });
  const inputs = (await inputsResp.json()) as any;
  const challenge = inputs.challenge;
  const decoded = JSON.parse(Buffer.from(challenge.input, "base64").toString());
  const ctype = decoded.challenge_type ?? "";
  const difficulty = decoded.difficulty ?? 1;
  const memory = decoded.memory ?? 128;

  const endpoint = ENDPOINT[ctype] ?? "verify";

  let solution: string;
  let body: string;
  let contentType: string;

  if (ctype === "NetworkBandwidth") {
    solution = solveBandwidth(difficulty);
    const boundary = "----WebKitFormBoundary" + randomBytes(8).toString("hex");
    const meta = {
      challenge,
      solution: null,
      signals: [{ name: config.identifier, value: { Present: encrypted } }],
      checksum,
      existing_token: null,
      client: "Browser",
      domain,
      metrics,
      ...(goku ? { goku_props: goku } : {}),
    };
    body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="solution_data"\r\n\r\n${solution}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="solution_metadata"\r\n\r\n${JSON.stringify(meta)}`,
      `--${boundary}--\r\n`,
    ].join("\r\n");
    contentType = `multipart/form-data; boundary=${boundary}`;
  } else {
    solution =
      ctype === "SHA256"
        ? solveSHA256(challenge.input, checksum, difficulty)
        : solveScrypt(challenge.input, checksum, difficulty, memory);
    body = JSON.stringify({
      challenge,
      solution,
      signals: [{ name: config.identifier, value: { Present: encrypted } }],
      checksum,
      existing_token: null,
      client: "Browser",
      domain,
      metrics,
      ...(goku ? { goku_props: goku } : {}),
    });
    contentType = "text/plain;charset=UTF-8";
  }

  const postResp = await fetch(`${config.challengeBaseUrl}/${endpoint}`, {
    method: "POST",
    headers: { ...hdrs, "content-type": contentType },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  const result = (await postResp.json()) as any;
  return result.token ?? result.response?.token ?? null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getWafToken(targetUrl: string): Promise<string | null> {
  if (cachedToken && Date.now() - cachedToken.obtainedAt < TOKEN_MAX_AGE_MS) {
    return cachedToken.value;
  }

  const parsedUrl = new URL(targetUrl);
  const site = parsedUrl.origin;
  const domain = parsedUrl.hostname;

  const { challengeBaseUrl, goku } = await discover(targetUrl, UA);

  // Re-extract config only if challenge.js URL changed
  if (!cachedConfig || cachedChallengeJsUrl !== challengeBaseUrl) {
    const scriptResp = await fetch(`${challengeBaseUrl}/challenge.js`, {
      headers: {
        ...apiHeaders(site, UA, false),
        "sec-fetch-dest": "script",
        "sec-fetch-mode": "no-cors",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!scriptResp.ok) throw new Error(`Failed to fetch challenge.js: ${scriptResp.status}`);
    const challengeScript = await scriptResp.text();

    cachedConfig = await extractCryptoConfig(challengeScript, challengeBaseUrl);
    cachedChallengeJsUrl = challengeBaseUrl;
  }

  let token: string | null = null;
  for (let round = 0; round < 2; round++) {
    token = await solveRound(cachedConfig, domain, site, goku, round > 0, UA);
    if (token) break;
  }

  if (token) {
    cachedToken = { value: token, obtainedAt: Date.now() };
  }

  return token;
}

export function invalidateWafToken(): void {
  cachedToken = null;
}

export { UA as WAF_USER_AGENT };
