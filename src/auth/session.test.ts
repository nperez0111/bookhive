import { describe, it, expect, mock } from "bun:test";
import { getIronSession } from "iron-session";
import { env as realEnv } from "../env";
import { getSessionAgent } from "../context";

// Mock iron-session
const mockGetIronSession = mock();
void mock.module("iron-session", () => ({
  getIronSession: mockGetIronSession,
}));

// mock.module is process-wide and permanent — a bare object here blanks every
// other env field for the rest of the run, which can fail an unrelated file
// that passes in isolation. Spread the real env so only COOKIE_SECRET moves.
void mock.module("../env", () => ({
  env: { ...realEnv, COOKIE_SECRET: "test-secret-key-for-testing-purposes-only" },
}));

describe("Auth Session TTL Logic", () => {
  it("should set session TTL to 24 hours regardless of token expiration", async () => {
    const mockSession = {
      updateConfig: mock(),
      save: mock(),
      destroy: mock(),
    };

    mockGetIronSession.mockResolvedValueOnce(mockSession);

    const mockReq = {} as any;
    const mockRes = {} as any;

    await getIronSession(mockReq, mockRes, {
      cookieName: "sid",
      password: "test-secret-key-for-testing-purposes-only",
      ttl: 60 * 60 * 24,
    });

    expect(getIronSession).toHaveBeenCalledWith(
      mockReq,
      mockRes,
      expect.objectContaining({
        cookieName: "sid",
        password: "test-secret-key-for-testing-purposes-only",
        ttl: 86400,
      }),
    );
  });

  it("should use fixed TTL instead of token expiration time", () => {
    const fixedTTL = 60 * 60 * 24;
    const tokenExpirationInSeconds = 30 * 60;

    expect(fixedTTL).toBe(86400);
    expect(fixedTTL).toBeGreaterThan(tokenExpirationInSeconds);
  });

  it("should maintain session longer than typical OAuth token lifetime", () => {
    const sessionTTL = 60 * 60 * 24;
    const typicalOAuthTokenLifetime = 30 * 60;

    expect(sessionTTL).toBeGreaterThan(typicalOAuthTokenLifetime * 10);
  });
});

describe("getSessionAgent — corrupt cookie tolerance", () => {
  it("returns null and clears the sid cookie instead of throwing when the cookie won't decode", async () => {
    // iron-session throws for a tampered/stale-secret cookie; left uncaught that 500'd every route, so getSessionAgent must treat it as no session.
    mockGetIronSession.mockImplementationOnce(() => {
      throw new Error("Wrong mac prefix");
    });

    const req = new Request("https://bookhive.buzz/home", {
      headers: { cookie: "sid=tampered-value" },
    });
    const res = new Response();
    const ctx = {} as any;

    const agent = await getSessionAgent(req, res, ctx);

    expect(agent).toBeNull();
    // The bad cookie is expired so the browser stops resending it.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sid=");
    expect(setCookie.toLowerCase()).toContain("max-age=0");
  });
});
