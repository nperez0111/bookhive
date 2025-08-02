import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shouldSyncFollows, getUserFollows, type FollowsSync } from './getFollows'
import type { AppContext } from '..'

// Mock logger
vi.mock('../logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  })
}))

// Mock KV storage
const mockKv = {
  get: vi.fn(),
  set: vi.fn(),
}

// Mock database
const mockDb = {
  selectFrom: vi.fn(() => ({
    select: vi.fn(() => ({
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              execute: vi.fn()
            }))
          }))
        }))
      }))
    }))
  }))
}

const mockCtx: AppContext = {
  kv: mockKv as any,
  db: mockDb as any,
} as any

describe('getFollows utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('shouldSyncFollows', () => {
    it('should return true when no previous sync data exists', async () => {
      mockKv.get.mockResolvedValue(null)
      
      const result = await shouldSyncFollows(mockCtx, 'did:plc:test123')
      
      expect(result).toBe(true)
      expect(mockKv.get).toHaveBeenCalledWith('follows_sync:did:plc:test123')
    })

    it('should return true when no lastIncrementalSync exists', async () => {
      const syncData: FollowsSync = {
        userDid: 'did:plc:test123',
        lastFullSync: '2025-08-01T10:00:00.000Z',
        lastIncrementalSync: null,
        cursor: null
      }
      mockKv.get.mockResolvedValue(syncData)
      
      const result = await shouldSyncFollows(mockCtx, 'did:plc:test123')
      
      expect(result).toBe(true)
    })

    it('should return false when last sync was recent (< 6 hours)', async () => {
      const recentTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3 hours ago
      const syncData: FollowsSync = {
        userDid: 'did:plc:test123',
        lastFullSync: '2025-08-01T10:00:00.000Z',
        lastIncrementalSync: recentTime,
        cursor: null
      }
      mockKv.get.mockResolvedValue(syncData)
      
      const result = await shouldSyncFollows(mockCtx, 'did:plc:test123')
      
      expect(result).toBe(false)
    })

    it('should return true when last sync was old (> 6 hours)', async () => {
      const oldTime = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() // 8 hours ago
      const syncData: FollowsSync = {
        userDid: 'did:plc:test123',
        lastFullSync: '2025-08-01T10:00:00.000Z',
        lastIncrementalSync: oldTime,
        cursor: null
      }
      mockKv.get.mockResolvedValue(syncData)
      
      const result = await shouldSyncFollows(mockCtx, 'did:plc:test123')
      
      expect(result).toBe(true)
    })

    it('should return true on KV error (fail safe)', async () => {
      mockKv.get.mockRejectedValue(new Error('KV error'))
      
      const result = await shouldSyncFollows(mockCtx, 'did:plc:test123')
      
      expect(result).toBe(true)
    })
  })

  describe('getUserFollows', () => {
    it('should query database with correct parameters and return follow DIDs', async () => {
      const mockFollows = [
        { followsDid: 'did:plc:follow1' },
        { followsDid: 'did:plc:follow2' },
        { followsDid: 'did:plc:follow3' }
      ]
      
      // Mock the query chain
      const mockExecute = vi.fn().mockResolvedValue(mockFollows)
      const mockLimit = vi.fn().mockReturnValue({ execute: mockExecute })
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockWhere2 = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
      const mockWhere1 = vi.fn().mockReturnValue({ where: mockWhere2 })
      const mockSelect = vi.fn().mockReturnValue({ where: mockWhere1 })
      mockDb.selectFrom.mockReturnValue({ select: mockSelect })
      
      const result = await getUserFollows(mockCtx, 'did:plc:test123', 100)
      
      expect(mockDb.selectFrom).toHaveBeenCalledWith('user_follows')
      expect(mockSelect).toHaveBeenCalledWith('followsDid')
      expect(mockWhere1).toHaveBeenCalledWith('userDid', '=', 'did:plc:test123')
      expect(mockWhere2).toHaveBeenCalledWith('isActive', '=', 1)
      expect(mockOrderBy).toHaveBeenCalledWith('syncedAt', 'desc')
      expect(mockLimit).toHaveBeenCalledWith(100)
      
      expect(result).toEqual(['did:plc:follow1', 'did:plc:follow2', 'did:plc:follow3'])
    })

    it('should return empty array when no follows found', async () => {
      const mockExecute = vi.fn().mockResolvedValue([])
      const mockLimit = vi.fn().mockReturnValue({ execute: mockExecute })
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockWhere2 = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
      const mockWhere1 = vi.fn().mockReturnValue({ where: mockWhere2 })
      const mockSelect = vi.fn().mockReturnValue({ where: mockWhere1 })
      mockDb.selectFrom.mockReturnValue({ select: mockSelect })
      
      const result = await getUserFollows(mockCtx, 'did:plc:test123')
      
      expect(result).toEqual([])
    })
  })
})