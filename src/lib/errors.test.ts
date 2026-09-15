import { describe, it, expect } from "bun:test";
import { errorMessage, MAX_LOG_CHARS, toErrorPayload, truncateForLog } from "./errors";

describe("errorMessage", () => {
  it("takes the message off an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else, because `catch` gives you `unknown`", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage({ nope: true })).toBe("[object Object]");
  });

  it("bounds the result — this is the point of the helper", () => {
    // The 43 hand-written `err instanceof Error ? err.message : String(err)`
    // copies this replaced were all unbounded; `truncateForLog` existed and was
    // called at exactly one of them.
    expect(errorMessage(new Error("x".repeat(MAX_LOG_CHARS * 2))).length).toBe(MAX_LOG_CHARS);
  });

  it("survives a thrown object with a hostile toString", () => {
    const hostile = {
      toString() {
        return "y".repeat(MAX_LOG_CHARS * 3);
      },
    };
    expect(errorMessage(hostile).length).toBe(MAX_LOG_CHARS);
  });
});

describe("truncateForLog", () => {
  it("leaves a short string alone", () => {
    expect(truncateForLog("short")).toBe("short");
  });

  it("cuts at the bound", () => {
    expect(truncateForLog("a".repeat(MAX_LOG_CHARS + 100))).toHaveLength(MAX_LOG_CHARS);
  });
});

describe("toErrorPayload", () => {
  it("reports message, type and stack for an Error", () => {
    const payload = toErrorPayload(new TypeError("bad type"));
    expect(payload.message).toBe("bad type");
    expect(payload.type).toBe("TypeError");
    expect(payload.stack).toContain("TypeError");
  });

  it("omits the stack when asked — a deliberate 4xx is control flow, not a defect", () => {
    const payload = toErrorPayload(new Error("unauthorized"), { stack: false });
    expect(payload).not.toHaveProperty("stack");
    expect(payload.message).toBe("unauthorized");
  });

  it("carries `cause`, which the XRPC copy had quietly dropped", () => {
    // A wrapped fetch failure logged from /xrpc/* used to lose the underlying
    // reason that the same failure kept when logged from a page route.
    const err = new Error("outer", { cause: new Error("inner") });
    expect(toErrorPayload(err).cause).toBe("inner");
  });

  it("accepts a string cause as well as an Error one", () => {
    const err = new Error("outer");
    (err as { cause?: unknown }).cause = "just a string";
    expect(toErrorPayload(err).cause).toBe("just a string");
  });

  it("omits `cause` when it is neither an Error nor a string", () => {
    const err = new Error("outer", { cause: { weird: true } });
    expect(toErrorPayload(err)).not.toHaveProperty("cause");
  });

  it("bounds the stack and the cause", () => {
    const err = new Error("outer", { cause: new Error("z".repeat(MAX_LOG_CHARS * 2)) });
    err.stack = "s".repeat(MAX_LOG_CHARS * 2);
    const payload = toErrorPayload(err);
    expect(payload.stack).toHaveLength(MAX_LOG_CHARS);
    expect(payload.cause).toHaveLength(MAX_LOG_CHARS);
  });

  it("degrades to a synthetic Error for a non-Error throw", () => {
    expect(toErrorPayload("just a string")).toEqual({ message: "just a string", type: "Error" });
  });
});
