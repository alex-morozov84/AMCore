import { AuthStageService, PUBLIC_STEP_MS } from '../stage/auth-stage.service'

import type { OAuthStateData } from './oauth-state.service'
import { OAuthStateService } from './oauth-state.service'

describe('OAuthStateService', () => {
  let service: OAuthStateService
  let mockRedis: { getDel: jest.Mock; set: jest.Mock }

  const state = 'random-state-abc123'
  const data: OAuthStateData = {
    provider: 'google',
    codeVerifier: 'verifier-xyz',
    mode: 'login',
    browserNonceHash: 'a'.repeat(64),
  }

  beforeEach(() => {
    mockRedis = {
      getDel: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    }

    service = new OAuthStateService(
      {
        call: (operation: (client: unknown) => unknown) => operation(mockRedis),
      } as never,
      new AuthStageService()
    )
  })

  describe('store', () => {
    it('should save state data with 5-minute TTL', async () => {
      await service.store(state, data)

      expect(mockRedis.set).toHaveBeenCalledWith(`oauth:state:${state}`, JSON.stringify(data), {
        expiration: { type: 'PX', value: 5 * 60 * 1000 },
      })
    })
  })

  describe('consume', () => {
    it('should return state data using atomic getDel', async () => {
      mockRedis.getDel.mockResolvedValue(JSON.stringify(data))

      const result = await service.consume(state)

      expect(result).toEqual(data)
      expect(mockRedis.getDel).toHaveBeenCalledWith(`oauth:state:${state}`)
    })

    it('should return null for missing or expired state', async () => {
      mockRedis.getDel.mockResolvedValue(null)

      const result = await service.consume(state)

      expect(result).toBeNull()
    })

    it('should prevent replay: second consume returns null', async () => {
      mockRedis.getDel
        .mockResolvedValueOnce(JSON.stringify(data)) // first call: found
        .mockResolvedValueOnce(null) // second call: already deleted

      const first = await service.consume(state)
      const second = await service.consume(state)

      expect(first).toEqual(data)
      expect(second).toBeNull()
    })

    it('should return null for corrupt state JSON', async () => {
      mockRedis.getDel.mockResolvedValue('{bad-json')

      const result = await service.consume(state)

      expect(result).toBeNull()
    })
  })

  describe('public operation root (T082)', () => {
    afterEach(() => jest.useRealTimers())

    it.each([
      ['store', (s: OAuthStateService) => s.store(state, data)],
      ['consume', (s: OAuthStateService) => s.consume(state)],
    ])(
      'answers 503 at the root budget when the Redis phase never settles: %s',
      async (_name, act) => {
        jest.useFakeTimers()
        const hung = new OAuthStateService(
          { call: () => new Promise(() => undefined) } as never,
          new AuthStageService()
        )
        const outcome = act(hung).catch((error: unknown) => error)
        await jest.advanceTimersByTimeAsync(PUBLIC_STEP_MS + 1)
        await expect(outcome).resolves.toMatchObject({ status: 503 })
      }
    )
  })
})
