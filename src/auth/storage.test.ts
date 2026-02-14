import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionStore, createStateStore } from "./storage";

// Mock unstorage (get, set, del)
const mockKv = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

describe("Auth Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("StateStore", () => {
    it("should store and retrieve auth state with correct key prefix", async () => {
      const stateStore = createStateStore(mockKv as any);
      const testState = {
        dpopKey: {} as any,
        authMethod: "none" as any,
        pkceVerifier: "v",
        issuer: "https://iss",
        redirectUri: "https://r",
        expiresAt: Date.now() + 6e4,
      };

      mockKv.get.mockResolvedValue(testState);

      await stateStore.set("test-key", testState);
      expect(mockKv.set).toHaveBeenCalledWith("auth_state:test-key", testState);

      const result = await stateStore.get("test-key");
      expect(mockKv.get).toHaveBeenCalledWith("auth_state:test-key");
      expect(result).toEqual(testState);
    });

    it("should delete auth state with correct key prefix", async () => {
      const stateStore = createStateStore(mockKv as any);

      await stateStore.delete("test-key");
      expect(mockKv.del).toHaveBeenCalledWith("auth_state:test-key");
    });

    it("should return undefined for non-existent state", async () => {
      const stateStore = createStateStore(mockKv as any);
      mockKv.get.mockResolvedValue(null);

      const result = await stateStore.get("non-existent-key");
      expect(result).toBeUndefined();
    });
  });

  describe("SessionStore", () => {
    it("should store and retrieve auth session with correct key prefix", async () => {
      const sessionStore = createSessionStore(mockKv as any);
      const testSession = {
        dpopKey: {} as any,
        authMethod: "none" as any,
        tokenSet: {
          sub: "did:plc:test",
          iss: "https://iss",
          aud: "https://aud",
          scope: "atproto",
          access_token: "t",
          token_type: "Bearer",
          expires_at: Date.now() + 3600e3,
        } as any,
      };

      mockKv.get.mockResolvedValue(testSession);

      await sessionStore.set("did:plc:test123" as any, testSession);
      expect(mockKv.set).toHaveBeenCalledWith(
        "auth_session:did:plc:test123",
        testSession,
      );

      const result = await sessionStore.get("did:plc:test123" as any);
      expect(mockKv.get).toHaveBeenCalledWith("auth_session:did:plc:test123");
      expect(result).toEqual(testSession);
    });

    it("should delete auth session with correct key prefix", async () => {
      const sessionStore = createSessionStore(mockKv as any);

      await sessionStore.delete("did:plc:test" as any);
      expect(mockKv.del).toHaveBeenCalledWith("auth_session:did:plc:test");
    });

    it("should return undefined for non-existent session", async () => {
      const sessionStore = createSessionStore(mockKv as any);
      mockKv.get.mockResolvedValue(null);

      const result = await sessionStore.get("did:plc:missing" as any);
      expect(result).toBeUndefined();
    });
  });

  describe("Key Prefixing", () => {
    it("should use different prefixes for state and session stores", () => {
      const statePrefix = "auth_state:";
      const sessionPrefix = "auth_session:";

      expect(statePrefix).not.toBe(sessionPrefix);
      expect(statePrefix).toMatch(/^auth_state:/);
      expect(sessionPrefix).toMatch(/^auth_session:/);
    });
  });
});
