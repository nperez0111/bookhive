import { describe, expect, test } from "bun:test";
import {
  MAX_PROTOCOL_BYTES,
  parseInputs,
  parseToken,
  readProtocolJson,
  WafProtocolError,
} from "./protocol";
import type { SolveDiagnostics, WafRequest, WafResult } from "./messages";
import { solveChallenge } from "./solver-worker";

const BANDWIDTH_TYPE = "ha9faaffd31b4d5ede2a2e19d2d7fd525f66fee61911511960dcbb52d3c48ce25";
const diagnostics = (): SolveDiagnostics => ({ stage: "challenge", round: 1 });
const inputs = (input: unknown = "opaque-signed-input") => ({
  challenge: { input, region: "eu-west-1" },
  challenge_type: BANDWIDTH_TYPE,
  difficulty: 1,
});

describe("WAF inputs protocol", () => {
  test("opaque input is preserved; solver metadata comes from the outer envelope", () => {
    for (const input of [
      "opaque-signed-input",
      '{"challenge_type":"SHA256","difficulty":99}',
      Buffer.from('{"challenge_type":"SHA256","difficulty":99}').toString("base64"),
      Buffer.from("\u05fdnot-json").toString("base64"),
    ]) {
      const value = inputs(input);
      const parsed = parseInputs(value, diagnostics());
      expect(parsed.challenge === value.challenge).toBe(true);
      expect(parsed.challenge.input).toBe(input);
      expect(parsed.type).toBe("NetworkBandwidth");
      expect(parsed.endpoint).toBe("mp_verify");
      expect(parsed.difficulty).toBe(1);
    }
  });

  test("known named and exact hashed dispatch keys only", () => {
    for (const [type, expected] of [
      ["NetworkBandwidth", "NetworkBandwidth"],
      ["SHA256", "SHA256"],
      ["HashcashScrypt", "HashcashScrypt"],
      ["h72f957df656e80ba55f5d8ce2e8c7ccb59687dba3bfb273d54b08a261b2f3002", "HashcashScrypt"],
      ["h7b0c470f0cfe3a80a9e26526ad185f484f6817d0832712a4a37a908786a6a67f", "SHA256"],
    ] as const) {
      expect(parseInputs({ ...inputs(), challenge_type: type }, diagnostics()).type).toBe(expected);
    }
    for (const type of ["h" + "f".repeat(64), "constructor", "toString", "remote\nsecret"]) {
      const context = diagnostics();
      expect(() => parseInputs({ ...inputs(), challenge_type: type }, context)).toThrow(
        "waf_unsupported_challenge_type",
      );
      if (type.includes("\n")) expect(context.challengeType).toBe("unrecognized");
    }
  });

  test("missing and invalid fields fail closed instead of guessing", () => {
    for (const value of [
      null,
      [],
      {},
      { challenge: null },
      { ...inputs(), challenge: [] },
      ...[undefined, null, 42, ""].map((input) => ({
        ...inputs(),
        challenge: { input, region: "eu-west-1" },
      })),
      { ...inputs(), challenge: { input: "opaque" } },
      { ...inputs(), challenge_type: undefined },
      ...[undefined, null, "1", 0, -1, 1.5, 6, NaN].map((difficulty) => ({
        ...inputs(),
        difficulty,
      })),
      // A guessed historical format cannot replace missing outer metadata.
      {
        challenge: {
          input: Buffer.from('{"challenge_type":"NetworkBandwidth","difficulty":1}').toString(
            "base64",
          ),
          region: "eu-west-1",
        },
      },
    ]) {
      expect(() => parseInputs(value, diagnostics())).toThrow("waf_inputs_invalid_shape");
    }
  });

  test("scrypt rejects invalid memory and impossible difficulty before computing", () => {
    for (const memory of [0, 1, 3, -2, 1.5, "128", 32768]) {
      expect(() =>
        parseInputs({ ...inputs(), challenge_type: "HashcashScrypt", memory }, diagnostics()),
      ).toThrow("waf_inputs_invalid_shape");
    }
    expect(() =>
      parseInputs({ ...inputs(), challenge_type: "SHA256", difficulty: 257 }, diagnostics()),
    ).toThrow("waf_inputs_invalid_shape");
  });
});

describe("bounded WAF JSON responses", () => {
  test("parses JSON without depending on a MIME declaration", async () => {
    expect(await readProtocolJson(new Response('{"ok":true}'), { stage: "inputs" })).toEqual({
      ok: true,
    });
  });

  test("HTTP and parser errors have safe stage codes and no remote body", async () => {
    for (const [response, reason] of [
      [new Response("private-body", { status: 503 }), "waf_inputs_http_error"],
      [
        new Response("\u05fdprivate-body", {
          headers: { "content-type": "text/html; secret=private-body" },
        }),
        "waf_inputs_invalid_json",
      ],
      [new Response(""), "waf_inputs_invalid_json"],
    ] as const) {
      try {
        await readProtocolJson(response, { stage: "inputs", round: 1 });
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(WafProtocolError);
        const failure = error as WafProtocolError;
        expect(failure.failure).toBe(reason);
        expect(failure.diagnostics.stage).toBe("inputs");
        expect(failure.diagnostics.status).toBe(response.status);
        expect(JSON.stringify(failure)).not.toContain("private-body");
        expect(failure.message).not.toContain("private-body");
      }
    }
  });

  test("limits declared and streamed bodies", () => {
    for (const response of [
      new Response("{}", { headers: { "content-length": String(MAX_PROTOCOL_BYTES + 1) } }),
      new Response("x".repeat(MAX_PROTOCOL_BYTES + 1)),
    ]) {
      expect(readProtocolJson(response, { stage: "verify" })).rejects.toThrow(
        "waf_verify_body_failed",
      );
    }
  });

  test("token extraction accepts known shapes, never arbitrary JSON types", () => {
    expect(parseToken({ token: "test-token" }, { stage: "verify" })).toBe("test-token");
    expect(parseToken({ response: { token: "test-token" } }, { stage: "verify" })).toBe(
      "test-token",
    );
    expect(parseToken({}, { stage: "verify" })).toBeNull();
    for (const value of [null, [], { token: 123 }, { token: {} }, { token: "" }]) {
      expect(() => parseToken(value, { stage: "verify" })).toThrow();
    }
  });
});

const BASE = "https://example.token.awswaf.com/a/b/c";
const request: WafRequest = {
  id: "test",
  site: "https://www.goodreads.com",
  domain: "www.goodreads.com",
  ua: "test-ua",
  challengeHtml: `<script src="${BASE}/challenge.js"></script>`,
  challengeJsUrl: BASE,
  config: {
    keyHex: "ab".repeat(32),
    identifier: "Test",
    signalVersion: "2.4.0",
    challengeBaseUrl: BASE,
  },
};
const envelope = inputs(Buffer.from("\u05fdopaque-signed-data").toString("base64"));

function stubFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("offline challenge orchestration (no network)", () => {
  test("worker entry echoes the request ID and safe failure diagnostics", async () => {
    const worker = new Worker(new URL("./solver-worker.ts", import.meta.url).href);
    try {
      const result = await new Promise<WafResult>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("worker test timed out")), 5_000);
        worker.onmessage = (event: MessageEvent<WafResult>) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          reject(new Error(event.message));
        };
        // No script URL means no network can be attempted by this request.
        worker.postMessage({ ...request, challengeHtml: "invalid interstitial" });
      });
      expect(result.id).toBe(request.id);
      expect(result.token).toBeNull();
      expect(result.failure).toBe("waf_discovery_failed");
      expect(result.diagnostics?.stage).toBe("discovery");
    } finally {
      worker.terminate();
    }
  });

  test("opaque outer-envelope challenge posts unchanged to multipart verify", async () => {
    const stub = stubFetch((url, init) => {
      if (url.endsWith("/inputs?client=browser")) return Response.json(envelope);
      expect(url).toBe(`${BASE}/mp_verify`);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toContain("multipart/form-data");
      const body = init?.body as string;
      expect(body).toContain(JSON.stringify(envelope.challenge));
      const solution = body.match(/name="solution_data"\r\n\r\n([^\r]+)/)?.[1];
      expect(Buffer.from(solution!, "base64")).toEqual(Buffer.alloc(1024));
      return Response.json({ token: "offline-token" });
    });
    const result = await solveChallenge(request, stub.fetchImpl);
    expect(result.token).toBe("offline-token");
    expect(stub.calls).toHaveLength(2);
    expect(result.diagnostics).toMatchObject({
      stage: "verify",
      round: 1,
      status: 200,
      challengeType: BANDWIDTH_TYPE,
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain(envelope.challenge.input);
  });

  test("hashcash variants use JSON verify with the same metadata and opaque challenge", async () => {
    for (const challenge_type of ["SHA256", "HashcashScrypt"]) {
      const stub = stubFetch((url, init) => {
        if (url.endsWith("/inputs?client=browser")) {
          return Response.json({ ...envelope, challenge_type, difficulty: 0 });
        }
        expect(url).toBe(`${BASE}/verify`);
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("content-type")).toBe("text/plain;charset=UTF-8");
        expect(JSON.parse(init?.body as string)).toMatchObject({
          challenge: envelope.challenge,
          solution: "0",
          signals: [{ name: "Test", value: { Present: expect.any(String) } }],
          checksum: expect.any(String),
          existing_token: null,
          client: "Browser",
          domain: request.domain,
          metrics: expect.any(Array),
        });
        return Response.json({ token: "offline-token" });
      });
      expect((await solveChallenge(request, stub.fetchImpl)).token).toBe("offline-token");
      expect(stub.calls).toHaveLength(2);
    }
  });

  test("unknown types do not post a guessed scrypt/bandwidth solution", async () => {
    const stub = stubFetch(() =>
      Response.json({ ...envelope, challenge_type: "h" + "f".repeat(64) }),
    );
    const result = await solveChallenge(request, stub.fetchImpl);
    expect(result.token).toBeNull();
    expect(result.failure).toBe("waf_unsupported_challenge_type");
    expect(result.diagnostics?.stage).toBe("challenge");
    expect(stub.calls).toHaveLength(1);
  });

  test("inputs HTTP/JSON/shape failures are distinct and never post", async () => {
    for (const [response, failure] of [
      [new Response("secret", { status: 503 }), "waf_inputs_http_error"],
      [new Response("\u05fdsecret"), "waf_inputs_invalid_json"],
      [Response.json({}), "waf_inputs_invalid_shape"],
    ] as const) {
      const stub = stubFetch(() => response);
      const result = await solveChallenge(request, stub.fetchImpl);
      expect(result.failure).toBe(failure);
      expect(result.token).toBeNull();
      expect(stub.calls).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  test("verification failures carry the verify stage without raw errors", async () => {
    const stub = stubFetch((url) =>
      url.endsWith("/inputs?client=browser")
        ? Response.json(envelope)
        : new Response("private-verification-body", { status: 403 }),
    );
    const result = await solveChallenge(request, stub.fetchImpl);
    expect(result.failure).toBe("waf_verify_http_error");
    expect(result.diagnostics).toMatchObject({ stage: "verify", status: 403 });
    expect(JSON.stringify(result)).not.toContain("private-verification-body");
    expect(stub.calls).toHaveLength(2);
  });

  test("two tokenless rounds stay bounded, with round-specific diagnostics", async () => {
    const stub = stubFetch((url) =>
      Response.json(url.endsWith("/inputs?client=browser") ? envelope : {}),
    );
    const result = await solveChallenge(request, stub.fetchImpl);
    expect(result.failure).toBe("waf_solve_failed");
    expect(result.diagnostics).toMatchObject({ stage: "verify", round: 2 });
    expect(stub.calls).toHaveLength(4);
  });

  test("discovery and crypto extraction errors don't leak remote text", async () => {
    const stub = stubFetch(() => new Response("secret-script-body"));
    const discovery = await solveChallenge(
      { ...request, challengeHtml: "secret-html" },
      stub.fetchImpl,
    );
    expect(discovery.failure).toBe("waf_discovery_failed");
    expect(stub.calls).toHaveLength(0);
    const crypto = await solveChallenge({ ...request, config: null }, stub.fetchImpl);
    expect(crypto.failure).toBe("waf_crypto_config_failed");
    expect(JSON.stringify(crypto)).not.toContain("secret-script-body");
  });
});
