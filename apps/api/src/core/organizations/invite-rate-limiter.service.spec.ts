import type { Cache } from 'cache-manager'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { AppException } from '../../common/exceptions'

import { InviteRateLimiterService } from './invite-rate-limiter.service'

describe('InviteRateLimiterService', () => {
  let service: InviteRateLimiterService
  let cache: DeepMockProxy<Cache>
  let logger: jest.Mocked<PinoLogger>

  const orgId = 'org-1'
  const emailCanonical = 'invitee@example.com'
  const inviterId = 'user-admin'

  beforeEach(() => {
    cache = mockDeep<Cache>()
    logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    service = new InviteRateLimiterService(cache as unknown as Cache, logger)
  })

  describe('check', () => {
    it('passes when both counters are below their limits', async () => {
      cache.get.mockResolvedValue(1)
      await expect(service.check(orgId, emailCanonical, inviterId)).resolves.toBeUndefined()
    })

    it('passes when counters are absent (first attempt)', async () => {
      cache.get.mockResolvedValue(undefined as unknown as number)
      await expect(service.check(orgId, emailCanonical, inviterId)).resolves.toBeUndefined()
    })

    it('throws 429 when per-pair counter is at limit (3/h)', async () => {
      cache.get.mockImplementation(async <T>(key: string) => {
        if (typeof key === 'string' && key.startsWith('rate:org_invite_pair:')) {
          return 3 as T
        }
        return 0 as T
      })
      await expect(service.check(orgId, emailCanonical, inviterId)).rejects.toThrow(AppException)
    })

    it('throws 429 when per-inviter counter is at limit (30/h)', async () => {
      cache.get.mockImplementation(async <T>(key: string) => {
        if (typeof key === 'string' && key.startsWith('rate:org_invite_actor:')) {
          return 30 as T
        }
        return 0 as T
      })
      await expect(service.check(orgId, emailCanonical, inviterId)).rejects.toThrow(AppException)
    })

    it('throws with retryAfterSeconds=3600 detail', async () => {
      cache.get.mockResolvedValue(30)
      const error = await service.check(orgId, emailCanonical, inviterId).catch((e) => e)
      expect(error).toBeInstanceOf(AppException)
      expect(error.details).toEqual({ retryAfterSeconds: 3600 })
    })
  })

  describe('consume', () => {
    it('increments both counters with 1h TTL', async () => {
      cache.get.mockResolvedValue(1)
      await service.consume(orgId, emailCanonical, inviterId)

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining(`rate:org_invite_pair:${orgId}:${emailCanonical}`),
        2,
        60 * 60 * 1000
      )
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining(`rate:org_invite_actor:${inviterId}:${orgId}`),
        2,
        60 * 60 * 1000
      )
    })

    it('starts counters from 1 when previously absent', async () => {
      cache.get.mockResolvedValue(undefined as unknown as number)
      await service.consume(orgId, emailCanonical, inviterId)
      expect(cache.set).toHaveBeenCalledWith(expect.any(String), 1, 60 * 60 * 1000)
    })

    it('logs at debug level — invite rate-limits are not abuse signals on their own', async () => {
      cache.get.mockResolvedValue(0)
      await service.consume(orgId, emailCanonical, inviterId)
      expect(logger.debug).toHaveBeenCalledTimes(1)
      expect(logger.warn).not.toHaveBeenCalled()
    })
  })
})
