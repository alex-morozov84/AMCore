import type { OAuthClientService } from '../oauth-client.service'

import { TelegramProvider } from './telegram.provider'

const mockConfig = {} as never

const providerConfig = {
  botToken: 'bot-token-123',
  redirectUri: 'https://example.com/auth/oauth/telegram/callback',
}

const skipStateCheck = Symbol('skipStateCheck')
const skipSubjectCheck = Symbol('skipSubjectCheck')

function makeMockClient(overrides: Partial<OAuthClientService> = {}): OAuthClientService {
  return {
    discovery: jest.fn().mockResolvedValue(mockConfig),
    calculatePKCECodeChallenge: jest.fn().mockResolvedValue('challenge'),
    buildAuthorizationUrl: jest.fn().mockReturnValue(new URL('https://oauth.telegram.org/auth')),
    authorizationCodeGrant: jest.fn(),
    fetchUserInfo: jest.fn(),
    skipStateCheck,
    skipSubjectCheck,
    ...overrides,
  } as unknown as OAuthClientService
}

describe('TelegramProvider', () => {
  describe('getAuthorizationURL', () => {
    it('should use openid phone scope and PKCE S256', async () => {
      const oauthClient = makeMockClient()
      const provider = new TelegramProvider(providerConfig, oauthClient)

      await provider.getAuthorizationURL('state-abc', 'verifier-xyz')

      expect(oauthClient.calculatePKCECodeChallenge).toHaveBeenCalledWith('verifier-xyz')
      expect(oauthClient.buildAuthorizationUrl).toHaveBeenCalledWith(mockConfig, {
        redirect_uri: providerConfig.redirectUri,
        scope: 'openid phone',
        state: 'state-abc',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      })
    })
  })

  describe('exchangeCode', () => {
    it('should exchange code and return OAuthTokens', async () => {
      const oauthClient = makeMockClient({
        authorizationCodeGrant: jest.fn().mockResolvedValue({
          access_token: 'tg-access-token',
          id_token: 'tg-id-token',
          expires_in: 3600,
        }),
      })
      const provider = new TelegramProvider(providerConfig, oauthClient)

      const result = await provider.exchangeCode('auth-code', 'verifier-xyz')

      expect(oauthClient.authorizationCodeGrant).toHaveBeenCalledWith(mockConfig, expect.any(URL), {
        pkceCodeVerifier: 'verifier-xyz',
        expectedState: skipStateCheck,
      })
      expect(result).toEqual({
        accessToken: 'tg-access-token',
        idToken: 'tg-id-token',
        expiresIn: 3600,
      })
    })
  })

  describe('getUserProfile', () => {
    it('should return profile with phone and no email', async () => {
      const oauthClient = makeMockClient({
        fetchUserInfo: jest.fn().mockResolvedValue({
          sub: 'tg-user-123',
          name: 'Telegram User',
          phone_number: '+79001234567',
        }),
      })
      const provider = new TelegramProvider(providerConfig, oauthClient)

      const result = await provider.getUserProfile({ accessToken: 'access-token' })

      expect(result).toEqual({
        providerId: 'tg-user-123',
        provider: 'telegram',
        email: null,
        emailVerified: false,
        displayName: 'Telegram User',
        avatarUrl: null,
        phone: '+79001234567',
      })
    })

    it('should return null phone when phone_number is missing', async () => {
      const oauthClient = makeMockClient({
        fetchUserInfo: jest.fn().mockResolvedValue({
          sub: 'tg-user-456',
        }),
      })
      const provider = new TelegramProvider(providerConfig, oauthClient)

      const result = await provider.getUserProfile({ accessToken: 'token' })

      expect(result.phone).toBeNull()
      expect(result.email).toBeNull()
      expect(result.emailVerified).toBe(false)
    })

    it('should use bot token as client_id during discovery', async () => {
      const oauthClient = makeMockClient()
      const provider = new TelegramProvider(providerConfig, oauthClient)

      await provider.getAuthorizationURL('state', 'verifier')

      expect(oauthClient.discovery).toHaveBeenCalledWith(
        new URL('https://oauth.telegram.org'),
        'bot-token-123',
        ''
      )
    })
  })
})
