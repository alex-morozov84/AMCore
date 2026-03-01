import type { OAuthClientService } from '../oauth-client.service'

import { GoogleProvider } from './google.provider'

const mockConfig = {} as never

const providerConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/auth/oauth/google/callback',
}

const skipStateCheck = Symbol('skipStateCheck')
const skipSubjectCheck = Symbol('skipSubjectCheck')

function makeMockClient(overrides: Partial<OAuthClientService> = {}): OAuthClientService {
  return {
    discovery: jest.fn().mockResolvedValue(mockConfig),
    calculatePKCECodeChallenge: jest.fn().mockResolvedValue('challenge'),
    buildAuthorizationUrl: jest.fn().mockReturnValue(new URL('https://accounts.google.com/auth')),
    authorizationCodeGrant: jest.fn(),
    fetchUserInfo: jest.fn(),
    skipStateCheck,
    skipSubjectCheck,
    ...overrides,
  } as unknown as OAuthClientService
}

describe('GoogleProvider', () => {
  describe('getAuthorizationURL', () => {
    it('should return URL with PKCE and state params', async () => {
      const expectedUrl = new URL('https://accounts.google.com/authorize?code_challenge=challenge')
      const oauthClient = makeMockClient({
        buildAuthorizationUrl: jest.fn().mockReturnValue(expectedUrl),
      })
      const provider = new GoogleProvider(providerConfig, oauthClient)

      const url = await provider.getAuthorizationURL('state-abc', 'verifier-xyz')

      expect(oauthClient.calculatePKCECodeChallenge).toHaveBeenCalledWith('verifier-xyz')
      expect(oauthClient.buildAuthorizationUrl).toHaveBeenCalledWith(mockConfig, {
        redirect_uri: providerConfig.redirectUri,
        scope: 'openid email profile',
        state: 'state-abc',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      })
      expect(url).toBe(expectedUrl)
    })
  })

  describe('exchangeCode', () => {
    it('should exchange code and return OAuthTokens', async () => {
      const oauthClient = makeMockClient({
        authorizationCodeGrant: jest.fn().mockResolvedValue({
          access_token: 'access-token',
          id_token: 'id-token',
          expires_in: 3600,
        }),
      })
      const provider = new GoogleProvider(providerConfig, oauthClient)

      const result = await provider.exchangeCode('auth-code', 'verifier-xyz')

      expect(oauthClient.authorizationCodeGrant).toHaveBeenCalledWith(mockConfig, expect.any(URL), {
        pkceCodeVerifier: 'verifier-xyz',
        expectedState: skipStateCheck,
      })
      expect(result).toEqual({
        accessToken: 'access-token',
        idToken: 'id-token',
        expiresIn: 3600,
      })
    })

    it('should include code in the callback URL', async () => {
      const oauthClient = makeMockClient({
        authorizationCodeGrant: jest.fn().mockResolvedValue({ access_token: 'token' }),
      })
      const provider = new GoogleProvider(providerConfig, oauthClient)

      await provider.exchangeCode('my-code', 'verifier')

      const callUrl = jest.mocked(oauthClient.authorizationCodeGrant).mock.calls[0]?.[1] as URL
      expect(callUrl.searchParams.get('code')).toBe('my-code')
    })
  })

  describe('getUserProfile', () => {
    it('should return normalized OAuthUserProfile', async () => {
      const oauthClient = makeMockClient({
        fetchUserInfo: jest.fn().mockResolvedValue({
          sub: '12345',
          email: 'user@example.com',
          email_verified: true,
          name: 'Test User',
          picture: 'https://example.com/avatar.jpg',
        }),
      })
      const provider = new GoogleProvider(providerConfig, oauthClient)

      const result = await provider.getUserProfile({ accessToken: 'access-token' })

      expect(oauthClient.fetchUserInfo).toHaveBeenCalledWith(
        mockConfig,
        'access-token',
        skipSubjectCheck
      )
      expect(result).toEqual({
        providerId: '12345',
        provider: 'google',
        email: 'user@example.com',
        emailVerified: true,
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
      })
    })

    it('should handle missing optional fields', async () => {
      const oauthClient = makeMockClient({
        fetchUserInfo: jest.fn().mockResolvedValue({
          sub: '12345',
          email: 'user@example.com',
          email_verified: false,
        }),
      })
      const provider = new GoogleProvider(providerConfig, oauthClient)

      const result = await provider.getUserProfile({ accessToken: 'token' })

      expect(result.displayName).toBeNull()
      expect(result.avatarUrl).toBeNull()
      expect(result.emailVerified).toBe(false)
    })
  })
})
