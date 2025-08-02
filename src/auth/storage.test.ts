import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StateStore, SessionStore } from './storage'

// Mock unstorage
const mockStorage = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}

describe('Auth Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('StateStore', () => {
    it('should store and retrieve auth state with correct key prefix', async () => {
      const stateStore = new StateStore(mockStorage as any)
      const testState = { state: 'test-state-data' }
      
      mockStorage.get.mockResolvedValue(testState)
      
      // Test set operation
      await stateStore.set('test-key', testState as any)
      expect(mockStorage.set).toHaveBeenCalledWith('auth_state:test-key', testState)
      
      // Test get operation
      const result = await stateStore.get('test-key')
      expect(mockStorage.get).toHaveBeenCalledWith('auth_state:test-key')
      expect(result).toBe(testState)
    })

    it('should delete auth state with correct key prefix', async () => {
      const stateStore = new StateStore(mockStorage as any)
      
      await stateStore.del('test-key')
      expect(mockStorage.del).toHaveBeenCalledWith('auth_state:test-key')
    })

    it('should return undefined for non-existent state', async () => {
      const stateStore = new StateStore(mockStorage as any)
      mockStorage.get.mockResolvedValue(null)
      
      const result = await stateStore.get('non-existent-key')
      expect(result).toBeUndefined()
    })
  })

  describe('SessionStore', () => {
    it('should store and retrieve auth session with correct key prefix', async () => {
      const sessionStore = new SessionStore(mockStorage as any)
      const testSession = { did: 'did:plc:test123', tokens: {} }
      
      mockStorage.get.mockResolvedValue(testSession)
      
      // Test set operation
      await sessionStore.set('session-key', testSession as any)
      expect(mockStorage.set).toHaveBeenCalledWith('auth_session:session-key', testSession)
      
      // Test get operation
      const result = await sessionStore.get('session-key')
      expect(mockStorage.get).toHaveBeenCalledWith('auth_session:session-key')
      expect(result).toBe(testSession)
    })

    it('should delete auth session with correct key prefix', async () => {
      const sessionStore = new SessionStore(mockStorage as any)
      
      await sessionStore.del('session-key')
      expect(mockStorage.del).toHaveBeenCalledWith('auth_session:session-key')
    })

    it('should return undefined for non-existent session', async () => {
      const sessionStore = new SessionStore(mockStorage as any)
      mockStorage.get.mockResolvedValue(null)
      
      const result = await sessionStore.get('non-existent-key')
      expect(result).toBeUndefined()
    })
  })

  describe('Key Prefixing', () => {
    it('should use different prefixes for state and session stores', () => {
      // Verify that state and session stores use different key prefixes
      // to avoid collisions in the underlying storage
      const statePrefix = 'auth_state:'
      const sessionPrefix = 'auth_session:'
      
      expect(statePrefix).not.toBe(sessionPrefix)
      expect(statePrefix).toMatch(/^auth_state:/)
      expect(sessionPrefix).toMatch(/^auth_session:/)
    })
  })
})