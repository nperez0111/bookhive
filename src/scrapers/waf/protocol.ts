import { boundedText } from "./http";
import type { SolveDiagnostics } from "./messages";

export const MAX_PROTOCOL_BYTES = 64 * 1024;

type ChallengeType = "NetworkBandwidth" | "HashcashScrypt" | "SHA256";

// Exact dispatch keys and algorithms in __fixtures__/challenge-script.js.
// A hash is an identifier, NOT evidence that an arbitrary new type is bandwidth.
const TYPES: Readonly<Record<string, ChallengeType>> = {
  NetworkBandwidth: "NetworkBandwidth",
  HashcashScrypt: "HashcashScrypt",
  SHA256: "SHA256",
  ha9faaffd31b4d5ede2a2e19d2d7fd525f66fee61911511960dcbb52d3c48ce25: "NetworkBandwidth",
  h72f957df656e80ba55f5d8ce2e8c7ccb59687dba3bfb273d54b08a261b2f3002: "HashcashScrypt",
  h7b0c470f0cfe3a80a9e26526ad185f484f6817d0832712a4a37a908786a6a67f: "SHA256",
};

export class WafProtocolError extends Error {
  constructor(
    readonly failure: string,
    readonly diagnostics: SolveDiagnostics,
  ) {
    super(failure);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The /inputs envelope owns the solver parameters. challenge.input is opaque
 *  signed data passed back unchanged, not base64-encoded JSON to interpret. */
export function parseInputs(value: unknown, diagnostics: SolveDiagnostics) {
  const invalid = () => new WafProtocolError("waf_inputs_invalid_shape", { ...diagnostics });
  if (!object(value) || !object(value["challenge"])) throw invalid();
  const { challenge, challenge_type: challengeType, difficulty, memory: rawMemory } = value;
  const { input, region } = challenge;
  if (
    typeof input !== "string" ||
    !input.length ||
    typeof region !== "string" ||
    !region.length ||
    typeof challengeType !== "string" ||
    !challengeType.length
  ) {
    throw invalid();
  }
  // Allowlisted character set and length: never echo arbitrary remote text.
  diagnostics.challengeType = /^[A-Za-z0-9_]{1,80}$/.test(challengeType)
    ? challengeType
    : "unrecognized";
  diagnostics.inputChars = input.length;
  const type = Object.hasOwn(TYPES, challengeType) ? TYPES[challengeType]! : null;
  if (!type) {
    throw new WafProtocolError("waf_unsupported_challenge_type", { ...diagnostics });
  }
  if (
    typeof difficulty !== "number" ||
    !Number.isInteger(difficulty) ||
    difficulty < (type === "NetworkBandwidth" ? 1 : 0) ||
    difficulty > (type === "NetworkBandwidth" ? 5 : type === "SHA256" ? 256 : 128)
  ) {
    throw invalid();
  }
  const memory = rawMemory ?? 128;
  // scryptSync's default maxmem is 32 MiB. Reject invalid/oversized N before
  // entering a CPU/memory-bound primitive; the worker also has a hard deadline.
  if (
    type === "HashcashScrypt" &&
    (typeof memory !== "number" ||
      !Number.isInteger(memory) ||
      memory < 2 ||
      memory > 16384 ||
      (memory & (memory - 1)) !== 0)
  ) {
    throw invalid();
  }
  return {
    challenge: challenge as Record<string, unknown> & { input: string; region: string },
    type,
    difficulty,
    memory: type === "HashcashScrypt" ? (memory as number) : 128,
    endpoint: type === "NetworkBandwidth" ? "mp_verify" : "verify",
  };
}

/** Bound both error and success bodies, and never surface JSON.parse's remote
 *  text excerpts in logs. MIME metadata is diagnostic, not the parsing gate. */
export async function readProtocolJson(response: Response, diagnostics: SolveDiagnostics) {
  diagnostics.status = response.status;
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  diagnostics.contentType =
    contentType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType)
      ? contentType.slice(0, 80)
      : "unknown";
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new WafProtocolError(`waf_${diagnostics.stage}_http_error`, { ...diagnostics });
  }
  let body: string;
  try {
    body = await boundedText(response, MAX_PROTOCOL_BYTES, diagnostics.stage);
  } catch {
    throw new WafProtocolError(`waf_${diagnostics.stage}_body_failed`, { ...diagnostics });
  }
  diagnostics.bodyBytes = Buffer.byteLength(body);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new WafProtocolError(`waf_${diagnostics.stage}_invalid_json`, { ...diagnostics });
  }
}

export function parseToken(value: unknown, diagnostics: SolveDiagnostics): string | null {
  if (!object(value)) {
    throw new WafProtocolError("waf_verify_invalid_shape", { ...diagnostics });
  }
  const { token: directToken, response } = value;
  const token = directToken ?? (object(response) ? response["token"] : undefined);
  if (token === undefined || token === null) return null;
  if (typeof token !== "string" || !token.length || token.length > 16 * 1024) {
    throw new WafProtocolError("waf_verify_invalid_token", { ...diagnostics });
  }
  return token;
}
