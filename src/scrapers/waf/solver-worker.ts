/// AWS WAF solver — runs entirely off the main thread as a Bun Worker.
///
/// It does exactly one thing: given a challenge interstitial the main thread
/// already fetched, produce an `aws-waf-token` (deobfuscation, browser
/// fingerprint, proof-of-work). It does **not** fetch Goodreads pages. Keeping
/// the page fetch on the main thread is what makes it impossible for a solver
/// problem to stop a page from being requested — see `solver.ts`.
///
/// The CPU-bound proof-of-work is why this is a Worker at all.

import { createCipheriv, randomBytes, createHash, scryptSync } from "crypto";
import { doExtract } from "./deobfuscate";
import { apiHeaders, boundedText, MAX_CHALLENGE_SCRIPT_BYTES } from "./http";
import type { SerializedConfig, WafRequest, WafResult } from "./messages";

declare var self: Worker;

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
    crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface CryptoConfig {
  key: Buffer;
  identifier: string;
  signalVersion: string;
  challengeBaseUrl: string;
}

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
    renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
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

// ─── Utility ────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
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

// ─── Crypto config ──────────────────────────────────────────────────────────

function extractCryptoConfig(challengeScript: string, challengeBaseUrl: string): CryptoConfig {
  const parsed = doExtract(challengeScript);
  if (!parsed.key) throw new Error("No AES key found in challenge.js");

  const keyBuf = Buffer.from(parsed.key, "hex");
  if (keyBuf.length !== 32) throw new Error(`Expected 32-byte key, got ${keyBuf.length}`);

  return {
    key: keyBuf,
    identifier: parsed.identifier ?? "Zoey",
    signalVersion: parsed.signalVersion ?? "2.4.0",
    challengeBaseUrl,
  };
}

function serializeConfig(c: CryptoConfig): SerializedConfig {
  return {
    keyHex: c.key.toString("hex"),
    identifier: c.identifier,
    signalVersion: c.signalVersion,
    challengeBaseUrl: c.challengeBaseUrl,
  };
}

function deserializeConfig(c: SerializedConfig): CryptoConfig {
  return {
    key: Buffer.from(c.keyHex, "hex"),
    identifier: c.identifier,
    signalVersion: c.signalVersion,
    challengeBaseUrl: c.challengeBaseUrl,
  };
}

// ─── Build browser fingerprint signals ──────────────────────────────────────

function buildSignals(ua: string, sigVersion: string): Record<string, any> {
  const now = Date.now();
  const [screenW = 1920, screenH = 1080] = randChoice(SCREENS);
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
      width: screenW,
      height: screenH,
      availWidth: screenW,
      availHeight: screenH - 40,
      colorDepth: 24,
      pixelDepth: 24,
    },
    window: {
      innerWidth: screenW,
      innerHeight: screenH - 117,
      outerWidth: screenW,
      outerHeight: screenH,
      devicePixelRatio: dpr,
    },
    tz: { offset: -300, timezone: "America/New_York" },
    time: { start: now - randInt(100, 300), elapsed: randInt(100, 300) },
    canvas: { hash: randomBytes(16).toString("hex") },
    gpu: {
      vendor: gpu.vendor,
      renderer: gpu.renderer,
      extensions: randInt(30, 40),
      viewportWidth: screenW,
      viewportHeight: screenH - 117,
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
        .update(`fonts_${screenW}_${randInt(0, 9999)}`)
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

function buildMetrics(hasToken: boolean): any[] {
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

  return m;
}

// ─── Challenge discovery ─────────────────────────────────────────────────────

function parseChallengePage(html: string): {
  challengeBaseUrl: string;
  goku: Record<string, any> | null;
} {
  const srcMatch = html.match(RE_CHAL_SRC);
  if (!srcMatch) {
    throw new Error(`Challenge URL not found (${html.length} chars)`);
  }
  const gokuMatch = html.match(RE_GOKU);
  return {
    challengeBaseUrl: srcMatch[1]!,
    goku: gokuMatch ? JSON.parse(gokuMatch[1]!) : null,
  };
}

async function fetchChallengeScript(
  challengeBaseUrl: string,
  site: string,
  ua: string,
): Promise<string> {
  const resp = await fetch(`${challengeBaseUrl}/challenge.js`, {
    headers: {
      ...apiHeaders(site, ua, false),
      "sec-fetch-dest": "script",
      "sec-fetch-mode": "no-cors",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Failed to fetch challenge.js: ${resp.status}`);
  return boundedText(resp, MAX_CHALLENGE_SCRIPT_BYTES, "challenge_js");
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

  const signals = buildSignals(ua, config.signalVersion);
  const encoded = encodeSignals(signals);
  const checksum = encoded.split("#")[0]!;
  const encrypted = encryptSignals(encoded, config.key);
  const metrics = buildMetrics(hasToken);

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

// ─── Orchestration ───────────────────────────────────────────────────────────

async function handle(req: WafRequest): Promise<Omit<WafResult, "id">> {
  const { challengeHtml, site, domain, ua } = req;
  let config: CryptoConfig | null = req.config ? deserializeConfig(req.config) : null;
  let challengeJsUrl = req.challengeJsUrl;
  const cached = () => ({
    config: config ? serializeConfig(config) : null,
    challengeJsUrl,
  });

  // 1. The main thread already has the challenge interstitial, so parse it
  //    directly rather than re-requesting the page just to see it again.
  const { challengeBaseUrl, goku } = parseChallengePage(challengeHtml);

  // 2. Ensure crypto config (re-extract only when challenge.js changes).
  if (!config || challengeJsUrl !== challengeBaseUrl) {
    const script = await fetchChallengeScript(challengeBaseUrl, site, ua);
    config = extractCryptoConfig(script, challengeBaseUrl);
    challengeJsUrl = challengeBaseUrl;
  }

  // 3. Solve. Two rounds: the WAF sometimes withholds a token on a first,
  //    tokenless attempt and issues one on the retry.
  for (let round = 0; round < 2; round++) {
    const token = await solveRound(config, domain, site, goku, round > 0, ua);
    if (token) return { token, ...cached() };
  }

  return { token: null, ...cached(), failure: "waf_solve_failed" };
}

// Every reply carries the request id so a late reply from a worker the caller
// already gave up on can never be mistaken for the answer to a new request.
self.onmessage = async (event: MessageEvent<WafRequest>) => {
  const req = event.data;
  try {
    self.postMessage({ ...(await handle(req)), id: req.id } satisfies WafResult);
  } catch (error) {
    self.postMessage({
      id: req.id,
      token: null,
      config: req.config,
      challengeJsUrl: req.challengeJsUrl,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WafResult);
  }
};
