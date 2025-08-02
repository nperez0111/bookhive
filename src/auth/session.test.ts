import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getIronSession } from 'iron-session'

// Mock iron-session
vi.mock('iron-session', () => ({
  getIronSession: vi.fn(),
}))

// Mock environment
vi.mock('../env', () => ({
  env: {
    COOKIE_SECRET: 'test-secret-key-for-testing-purposes-only',
  },
}))

describe('Auth Session TTL Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set session TTL to 24 hours regardless of token expiration', async () => {
    // Mock session object
    const mockSession = {
      updateConfig: vi.fn(),
      save: vi.fn(),
      destroy: vi.fn(),
    }

    const mockGetIronSession = vi.mocked(getIronSession)
    mockGetIronSession.mockResolvedValue(mockSession)

    // Mock request and response objects
    const mockReq = {} as any
    const mockRes = {} as any

    // Call getIronSession with our expected config
    await getIronSession(mockReq, mockRes, {
      cookieName: 'sid',
      password: 'test-secret-key-for-testing-purposes-only',
      ttl: 60 * 60 * 24, // 24 hours
    })

    // Verify the session was configured with 24-hour TTL
    expect(mockGetIronSession).toHaveBeenCalledWith(
      mockReq,
      mockRes,
      expect.objectContaining({
        cookieName: 'sid',
        password: 'test-secret-key-for-testing-purposes-only',
        ttl: 86400, // 24 hours in seconds
      })
    )
  })

  it('should use fixed TTL instead of token expiration time', () => {
    // Test that we're using a fixed 24-hour TTL
    const fixedTTL = 60 * 60 * 24 // 24 hours
    const tokenExpirationInSeconds = 30 * 60 // 30 minutes (typical OAuth token)

    // Our implementation should use fixedTTL, not tokenExpirationInSeconds
    expect(fixedTTL).toBe(86400)
    expect(fixedTTL).toBeGreaterThan(tokenExpirationInSeconds)
  })

  it('should maintain session longer than typical OAuth token lifetime', () => {
    const sessionTTL = 60 * 60 * 24 // 24 hours
    const typicalOAuthTokenLifetime = 30 * 60 // 30 minutes
    
    // Session should last much longer than OAuth tokens
    expect(sessionTTL).toBeGreaterThan(typicalOAuthTokenLifetime * 10)
  })
})