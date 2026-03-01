import type { OAuthStateData } from './oauth-state.service'
import { OAuthStateService } from './oauth-state.service'

describe('OAuthStateService', () => {
  let service: OAuthStateService
  let mockCache: { get: jest.Mock; set: jest.Mock; del: jest.Mock }

  const state = 'random-state-abc123'
  const data: OAuthStateData = { provider: 'google', codeVerifier: 'verifier-xyz' }

  beforeEach(() => {
    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    }

    service = new OAuthStateService(mockCache as never)
  })

  describe('store', () => {
    it('should save state data with 5-minute TTL', async () => {
      await service.store(state, data)

      expect(mockCache.set).toHaveBeenCalledWith(`oauth:state:${state}`, data, 5 * 60 * 1000)
    })
  })

  describe('consume', () => {
    it('should return state data and delete key', async () => {
      mockCache.get.mockResolvedValue(data)

      const result = await service.consume(state)

      expect(result).toEqual(data)
      expect(mockCache.del).toHaveBeenCalledWith(`oauth:state:${state}`)
    })

    it('should return null for missing or expired state', async () => {
      mockCache.get.mockResolvedValue(null)

      const result = await service.consume(state)

      expect(result).toBeNull()
      expect(mockCache.del).not.toHaveBeenCalled()
    })

    it('should prevent replay: second consume returns null', async () => {
      mockCache.get
        .mockResolvedValueOnce(data) // first call: found
        .mockResolvedValueOnce(null) // second call: already deleted

      const first = await service.consume(state)
      const second = await service.consume(state)

      expect(first).toEqual(data)
      expect(second).toBeNull()
    })
  })
})
