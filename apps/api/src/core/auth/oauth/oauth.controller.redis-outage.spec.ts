import type { Request, Response } from 'express'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'
import type { EnvService } from '../../../env/env.service.js'
import type { PasswordLoginService } from '../password-login.service.js'
import type { SessionService } from '../session.service.js'
import type { TokenService } from '../token.service.js'

import { OAuthController } from './oauth.controller.js'
import type { OAuthService } from './oauth.service.js'
import type { OAuthLoginTicketService } from './oauth-login-ticket.service.js'
import type { OAuthProviderFactory } from './providers/oauth-provider.factory.js'

// These cases pin, with mocked services, the call and cookie ordering when Redis fails at each
// one-time OAuth step. They prove neither HTTP envelopes nor persisted account state; the
// start and exchange envelopes under a stalled Redis are covered by the whole-app outage e2e,
// the callback over HTTP is not.

const outage = (): ServiceUnavailableException =>
  new ServiceUnavailableException('Authentication temporarily unavailable')

describe('OAuthController under a Redis outage', () => {
  let login: { beginOAuth: jest.Mock }
  let oauthService: { handleCallback: jest.Mock }
  let tickets: { issue: jest.Mock; consume: jest.Mock }
  let controller: OAuthController

  const request = (cookies: Record<string, string> = {}): Request =>
    ({ cookies, headers: {}, ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' } }) as never
  const response = (): jest.Mocked<
    Pick<Response, 'cookie' | 'clearCookie' | 'status' | 'redirect'>
  > => {
    const res = {
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
    }
    return res as never
  }
  const identityResult = {
    mode: 'login_identity',
    user: { locale: 'en', email: 'user@example.test' },
    identity: { userId: 'user-1', systemRole: 'USER' },
  }

  beforeEach(() => {
    login = { beginOAuth: jest.fn() }
    oauthService = { handleCallback: jest.fn() }
    tickets = { issue: jest.fn(), consume: jest.fn() }
    controller = new OAuthController(
      login as unknown as PasswordLoginService,
      oauthService as unknown as OAuthService,
      tickets as unknown as OAuthLoginTicketService,
      { callbackUri: jest.fn() } as unknown as OAuthProviderFactory,
      {} as unknown as SessionService,
      { hashRefreshToken: (value: string) => `hash:${value}` } as unknown as TokenService,
      {
        get: (key: string) => (key === 'TRUSTED_WEB_PEERS' ? undefined : 'test'),
      } as unknown as EnvService
    )
  })

  describe('callback', () => {
    it('answers 503 before any cookie or redirect when the state step fails', async () => {
      oauthService.handleCallback.mockRejectedValue(outage())
      const res = response()

      await expect(
        controller.callbackGet(
          'google',
          'code',
          'state',
          request({ oauth_state: 'n' }),
          res as never
        )
      ).rejects.toBeInstanceOf(ServiceUnavailableException)

      expect(res.cookie).not.toHaveBeenCalled()
      expect(res.redirect).not.toHaveBeenCalled()
      expect(res.clearCookie).not.toHaveBeenCalled()
      expect(tickets.issue).not.toHaveBeenCalled()
    })

    it('sets no exchange cookie and redirects nowhere when the ticket cannot be stored', async () => {
      oauthService.handleCallback.mockResolvedValue(identityResult)
      tickets.issue.mockRejectedValue(outage())
      const res = response()

      await expect(
        controller.callbackGet('google', 'code', 'state', request(), res as never)
      ).rejects.toBeInstanceOf(ServiceUnavailableException)

      // The committed account or link is not rolled back and the provider code is not re-used.
      expect(oauthService.handleCallback).toHaveBeenCalledTimes(1)
      expect(tickets.issue).toHaveBeenCalledTimes(1)
      expect(res.cookie).not.toHaveBeenCalled()
      expect(res.redirect).not.toHaveBeenCalled()
    })

    it('sets the binding cookie only after the ticket was stored', async () => {
      oauthService.handleCallback.mockResolvedValue(identityResult)
      tickets.issue.mockResolvedValue('ticket-1')
      const res = response()
      const order: string[] = []
      tickets.issue.mockImplementation(async () => {
        order.push('issue')
        return 'ticket-1'
      })
      res.cookie.mockImplementation((() => {
        order.push('cookie')
        return res
      }) as never)

      await controller.callbackGet('google', 'code', 'state', request(), res as never)

      expect(order).toEqual(['issue', 'cookie'])
      expect(res.redirect).toHaveBeenCalledTimes(1)
    })
  })

  describe('exchange', () => {
    it('answers 503 and starts no login when the ticket step fails', async () => {
      tickets.consume.mockRejectedValue(outage())
      const res = response()

      await expect(
        controller.exchange(
          { ticket: 'ticket-1' } as never,
          request({ refresh_token: 'b' }),
          res as never
        )
      ).rejects.toBeInstanceOf(ServiceUnavailableException)

      expect(login.beginOAuth).not.toHaveBeenCalled()
      expect(res.cookie).not.toHaveBeenCalled()
    })

    it('does not consume a ticket at all without the binding cookie', async () => {
      await expect(
        controller.exchange({ ticket: 'ticket-1' } as never, request(), response() as never)
      ).rejects.toBeDefined()
      expect(tickets.consume).not.toHaveBeenCalled()
    })
  })
})
