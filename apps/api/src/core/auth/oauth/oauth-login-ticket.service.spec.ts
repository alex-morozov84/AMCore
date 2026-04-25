import { createHash } from 'crypto'

import { SystemRole } from '@amcore/shared'

import type { OAuthLoginTicketClaims } from './oauth-login-ticket.service'
import { OAuthLoginTicketService } from './oauth-login-ticket.service'

describe('OAuthLoginTicketService', () => {
  let service: OAuthLoginTicketService
  let mockRedis: { getDel: jest.Mock; set: jest.Mock }

  const claims: OAuthLoginTicketClaims = {
    userId: 'user-123',
    email: 'oauth@example.com',
    systemRole: SystemRole.User,
    sessionId: 'session-123',
  }

  beforeEach(() => {
    mockRedis = {
      getDel: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    }

    service = new OAuthLoginTicketService(mockRedis as never)
  })

  describe('issue', () => {
    it('should issue a raw ticket and store claims under a sha256 key with 60s TTL', async () => {
      const ticket = await service.issue(claims)
      const hash = createHash('sha256').update(ticket).digest('hex')

      expect(ticket).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(mockRedis.set).toHaveBeenCalledWith(`oauth:ticket:${hash}`, JSON.stringify(claims), {
        expiration: { type: 'PX', value: 60 * 1000 },
      })
      expect(mockRedis.set.mock.calls[0]![0]).not.toContain(ticket)
    })
  })

  describe('consume', () => {
    it('should return claims for a valid ticket using atomic getDel', async () => {
      mockRedis.getDel.mockResolvedValue(JSON.stringify(claims))

      const result = await service.consume('raw-ticket')
      const hash = createHash('sha256').update('raw-ticket').digest('hex')

      expect(result).toEqual(claims)
      expect(mockRedis.getDel).toHaveBeenCalledWith(`oauth:ticket:${hash}`)
    })

    it('should return null for missing, expired, or already used tickets', async () => {
      mockRedis.getDel.mockResolvedValue(null)

      await expect(service.consume('missing-ticket')).resolves.toBeNull()
    })

    it('should return null for corrupt ticket JSON', async () => {
      mockRedis.getDel.mockResolvedValue('{bad-json')

      await expect(service.consume('raw-ticket')).resolves.toBeNull()
    })

    it('should prevent replay: second consume returns null', async () => {
      mockRedis.getDel.mockResolvedValueOnce(JSON.stringify(claims)).mockResolvedValueOnce(null)

      await expect(service.consume('raw-ticket')).resolves.toEqual(claims)
      await expect(service.consume('raw-ticket')).resolves.toBeNull()
    })
  })
})
