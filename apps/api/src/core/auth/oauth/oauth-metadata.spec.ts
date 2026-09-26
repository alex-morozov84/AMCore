import type { Request, Response } from 'express'

import { DEFAULT_LOCALE, localePathPrefix } from '@amcore/shared'

import { resolveTrustedWebPeers } from '../../../common/utils/trusted-web-peer'
import type { EnvService } from '../../../env/env.service'

import { OAuthController } from './oauth.controller'

jest.mock('./oauth.service', () => ({ OAuthService: class {} }))
jest.mock('./providers/oauth-provider.factory', () => ({ OAuthProviderFactory: class {} }))

it.each(['google', 'apple'])(
  '%s callback passes verified Session metadata while preserving browser binding',
  async (provider) => {
    const handleCallback = jest.fn().mockResolvedValue({
      mode: 'login',
      user: { locale: DEFAULT_LOCALE },
      refreshToken: 'fixture-refresh',
      sessionId: 'session',
      accessClaims: { sub: 'user' },
    })
    const issue = jest.fn().mockResolvedValue('ticket')
    const env = {
      get: (key: string) =>
        key === 'TRUSTED_WEB_PEERS'
          ? resolveTrustedWebPeers('172.20.0.5')
          : key === 'FRONTEND_URL'
            ? 'http://web.test'
            : 'development',
    } as unknown as EnvService
    const controller = new OAuthController(
      { handleCallback } as never,
      { issue } as never,
      {} as never,
      {} as never,
      {} as never,
      env
    )
    const req = {
      ip: '172.20.0.5',
      socket: { remoteAddress: '::ffff:172.20.0.5' },
      headers: { 'user-agent': 'OAuth browser', 'x-amcore-client-ip': '81.2.69.142' },
      cookies: { oauth_state: 'get-binding', oauth_state_apple: 'post-binding' },
    } as unknown as Request
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response
    if (provider === 'apple')
      await controller.callbackPost(provider, 'code', 'state', undefined, req, res)
    else await controller.callbackGet(provider, 'code', 'state', req, res)
    expect(handleCallback).toHaveBeenCalledWith(
      provider,
      'code',
      'state',
      provider === 'apple' ? 'post-binding' : 'get-binding',
      { userAgent: 'OAuth browser', ipAddress: '81.2.69.142' },
      provider === 'apple' ? null : undefined
    )
    expect(issue).toHaveBeenCalledTimes(1)
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'fixture-refresh',
      expect.objectContaining({ httpOnly: true })
    )
    expect(res.redirect).toHaveBeenCalledWith(
      `http://web.test${localePathPrefix(DEFAULT_LOCALE)}/auth/callback?ticket=ticket`
    )
  }
)
