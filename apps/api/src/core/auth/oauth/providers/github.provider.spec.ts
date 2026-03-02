import { HttpStatus } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../../common/exceptions'

import { GitHubProvider } from './github.provider'

const providerConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/auth/oauth/github/callback',
}

function mockFetch(response: unknown, ok = true): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    json: jest.fn().mockResolvedValue(response),
  } as unknown as Response)
}

describe('GitHubProvider', () => {
  let provider: GitHubProvider

  beforeEach(() => {
    provider = new GitHubProvider(providerConfig)
    jest.restoreAllMocks()
  })

  describe('getAuthorizationURL', () => {
    it('should return GitHub authorization URL with correct params', async () => {
      const url = await provider.getAuthorizationURL('state-abc', 'ignored-verifier')

      expect(url.hostname).toBe('github.com')
      expect(url.searchParams.get('client_id')).toBe('client-id')
      expect(url.searchParams.get('redirect_uri')).toBe(providerConfig.redirectUri)
      expect(url.searchParams.get('scope')).toBe('read:user user:email')
      expect(url.searchParams.get('state')).toBe('state-abc')
    })

    it('should not include code_challenge (GitHub has no PKCE)', async () => {
      const url = await provider.getAuthorizationURL('state', 'verifier')

      expect(url.searchParams.has('code_challenge')).toBe(false)
    })
  })

  describe('exchangeCode', () => {
    it('should exchange code and return access token', async () => {
      mockFetch({ access_token: 'gh-token' })

      const result = await provider.exchangeCode('auth-code', 'ignored')

      expect(fetch).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Accept: 'application/json' }),
          body: expect.stringContaining('"code":"auth-code"'),
        })
      )
      expect(result).toEqual({ accessToken: 'gh-token' })
    })

    it('should throw on GitHub token error response', async () => {
      mockFetch({ error: 'bad_verification_code', error_description: 'Code expired' })

      await expect(provider.exchangeCode('bad-code', '')).rejects.toThrow(AppException)
    })

    it('should throw with OAUTH_PROVIDER_ERROR code on failure', async () => {
      mockFetch({ error: 'bad_verification_code', error_description: 'Code expired' })

      const err = await provider.exchangeCode('bad-code', '').catch((e: unknown) => e)

      expect((err as AppException).getStatus()).toBe(HttpStatus.BAD_GATEWAY)
      expect(((err as AppException).getResponse() as Record<string, unknown>).errorCode).toBe(
        AuthErrorCode.OAUTH_PROVIDER_ERROR
      )
    })
  })

  describe('getUserProfile', () => {
    it('should return normalized profile with verified primary email', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            id: 42,
            name: 'Test User',
            login: 'testuser',
            email: null,
            avatar_url: 'https://github.com/avatar.jpg',
          }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue([
            { email: 'primary@example.com', primary: true, verified: true },
            { email: 'other@example.com', primary: false, verified: true },
          ]),
        } as unknown as Response)

      const result = await provider.getUserProfile({ accessToken: 'token' })

      expect(result).toEqual({
        providerId: '42',
        provider: 'github',
        email: 'primary@example.com',
        emailVerified: true,
        displayName: 'Test User',
        avatarUrl: 'https://github.com/avatar.jpg',
      })
    })

    it('should fall back to login as displayName when name is null', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            id: 1,
            name: null,
            login: 'octocat',
            email: null,
            avatar_url: null,
          }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue([]),
        } as unknown as Response)

      const result = await provider.getUserProfile({ accessToken: 'token' })

      expect(result.displayName).toBe('octocat')
      expect(result.email).toBeNull()
      expect(result.emailVerified).toBe(false)
    })

    it('should throw when user API returns non-ok response', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: false } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue([]),
        } as unknown as Response)

      await expect(provider.getUserProfile({ accessToken: 'token' })).rejects.toThrow(AppException)
    })
  })
})
