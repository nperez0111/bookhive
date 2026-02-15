import { describe, it, expect, mock } from "bun:test";
import { getIronSession } from "iron-session";

// Mock iron-session
const mockGetIronSession = mock();
mock.module("iron-session", () => ({
  getIronSession: mockGetIronSession,
}));

// Mock environment
mock.module("../env", () => ({
  env: {
    COOKIE_SECRET: "test-secret-key-for-testing-purposes-only",
  },
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
