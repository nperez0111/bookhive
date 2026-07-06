/// WAF challenge.js deobfuscation.
///
/// Pure function — no worker/network. It evaluates the obfuscated string-array
/// + decoder functions out of `challenge.js` via `new Function()` and brute-
/// forces the decoded string table to recover the AES key, signal identifier,
/// and signal version. Imported by `solver-worker.ts`; can also be run directly
/// as a CLI for offline testing (see README).

export interface ExtractedConfig {
  key: string | null;
  identifier: string | null;
  signalVersion: string | null;
  decodedCount: number;
}

function extractFunctionAt(s: string, startPos: number): string | null {
  const braceStart = s.indexOf("{", startPos);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let i = braceStart; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return s.substring(startPos, i + 1);
    }
  }
  return null;
}

function findRotationIIFE(script: string, arrayFuncName: string): string[] | null {
  const callPattern = new RegExp(
    "\\}\\)\\s*\\(\\s*" + arrayFuncName + "\\s*,\\s*0x[0-9a-f]+\\s*\\)\\s*;?",
  );
  const callMatch = script.match(callPattern);
  if (!callMatch) return null;

  const callEnd = script.indexOf(callMatch[0]) + callMatch[0].length;
  const bodyEnd = script.indexOf(callMatch[0]);

  let i = bodyEnd - 1;
  let depth = 1;
  while (i > 0 && depth > 0) {
    if (script[i] === "}") depth++;
    if (script[i] === "{") depth--;
    i--;
  }
  while (i > 0 && script[i] !== "(") i--;

  const iife = script.substring(i, callEnd);
  if (iife.includes("push") && iife.includes("shift")) return [iife];
  return null;
}

export function doExtract(script: string): ExtractedConfig {
  const arrayNameMatch = script.match(
    /function\s+(a0_0x[0-9a-f]+)\s*\(\)\s*\{(?:var|let|const)\s+_0x[0-9a-f]+=\[/,
  );
  if (!arrayNameMatch) throw new Error("Could not find global string array function");

  const decoderNameMatch = script.match(
    /function\s+(a0_0x[0-9a-f]+)\s*\(\s*_0x[0-9a-f]+\s*,\s*_0x[0-9a-f]+\s*\)/,
  );
  if (!decoderNameMatch) throw new Error("Could not find decoder function");

  const arrayFuncCode = extractFunctionAt(script, script.indexOf(arrayNameMatch[0]));
  if (!arrayFuncCode) throw new Error("Failed to extract array function body");

  const decoderFuncCode = extractFunctionAt(script, script.indexOf(decoderNameMatch[0]));
  if (!decoderFuncCode) throw new Error("Failed to extract decoder function body");

  const rotationMatch = findRotationIIFE(script, arrayNameMatch[1]!);

  let setupCode = arrayFuncCode + ";\n" + decoderFuncCode + ";\n";
  if (rotationMatch) setupCode += rotationMatch[0] + ";\n";
  setupCode += "return " + decoderNameMatch[1] + ";\n";

  // oxlint-disable-next-line no-implied-eval -- intentional: evaluates deobfuscated code to extract config
  const decoder = new Function(setupCode)();
  if (typeof decoder !== "function") throw new Error("Decoder is not a function");

  let key: string | null = null;
  let identifier: string | null = null;
  let signalVersion: string | null = null;
  const decoded = new Map<number, string>();

  for (let i = 0; i < 0x600; i++) {
    try {
      const val = decoder(i);
      if (typeof val === "string" && val.length > 0) {
        decoded.set(i, val);
        if (!key && /^[0-9a-f]{64}$/.test(val)) key = val;
        if (!signalVersion && /^\d+\.\d+\.\d+$/.test(val) && val !== "0.1.0") signalVersion = val;
      }
    } catch {}
  }

  let presentIdx = -1;
  for (const [idx, val] of decoded) {
    if (val === "Present") {
      presentIdx = idx;
      break;
    }
  }
  if (presentIdx >= 0) {
    const skip = new Set([
      "Present",
      "Browser",
      "String",
      "Count",
      "Milliseconds",
      "Object",
      "Array",
      "Function",
      "Error",
      "Number",
      "Boolean",
      "RegExp",
      "Date",
      "Symbol",
      "Promise",
      "Proxy",
      "Map",
      "Set",
      "Uint8Array",
      "ArrayBuffer",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "UNIVERSAL",
      "SEQUENCE",
      "INTEGER",
      "OCTET",
      "BOOLEAN",
    ]);
    for (let offset = -20; offset <= 0; offset++) {
      const val = decoded.get(presentIdx + offset);
      if (val && /^[A-Z][a-z]{1,15}$/.test(val) && !skip.has(val)) {
        identifier = val;
        break;
      }
    }
  }

  return { key, identifier, signalVersion, decodedCount: decoded.size };
}

// CLI mode (offline testing): `bun run deobfuscate.ts <challenge.js path>`.
// `import.meta.main` is false when this module is imported (e.g. by the worker).
if (import.meta.main && process.argv[2]) {
  try {
    const script = await Bun.file(process.argv[2]).text();
    process.stdout.write(JSON.stringify(doExtract(script)));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
    process.exit(1);
  }
}
