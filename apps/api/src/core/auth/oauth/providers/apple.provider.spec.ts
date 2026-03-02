import type { OAuthClientService } from '../oauth-client.service'

import type { AppleProviderConfig } from './apple.provider'
import { AppleProvider } from './apple.provider'

const mockConfig = {} as never
const mockClientAuth = {} as never

const providerConfig: AppleProviderConfig = {
  clientId: 'com.example.app',
  clientSecret: '',
  redirectUri: 'https://example.com/auth/oauth/apple/callback',
  teamId: 'TEAM123',
  keyId: 'KEY456',
  privateKey: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
}

const skipStateCheck = Symbol('skipStateCheck')
const skipSubjectCheck = Symbol('skipSubjectCheck')

function makeMockClient(overrides: Partial<OAuthClientService> = {}): OAuthClientService {
  return {
    generateAppleClientSecret: jest.fn().mockResolvedValue('mock-client-secret-jwt'),
    discovery: jest.fn().mockResolvedValue(mockConfig),
    clientSecretPost: jest.fn().mockReturnValue(mockClientAuth),
    calculatePKCECodeChallenge: jest.fn().mockResolvedValue('challenge'),
    buildAuthorizationUrl: jest.fn().mockReturnValue(new URL('https://appleid.apple.com/auth')),
    authorizationCodeGrant: jest.fn(),
    fetchUserInfo: jest.fn(),
    skipStateCheck,
    skipSubjectCheck,
    ...overrides,
  } as unknown as OAuthClientService
}

describe('AppleProvider', () => {
  describe('getAuthorizationURL', () => {
    it('should return Apple authorization URL with PKCE and form_post', async () => {
      const expectedUrl = new URL('https://appleid.apple.com/auth?scope=openid')
      const oauthClient = makeMockClient({
        buildAuthorizationUrl: jest.fn().mockReturnValue(expectedUrl),
      })
      const provider = new AppleProvider(providerConfig, oauthClient)

      const url = await provider.getAuthorizationURL('state-abc', 'verifier-xyz')

      expect(oauthClient.calculatePKCECodeChallenge).toHaveBeenCalledWith('verifier-xyz')
      expect(oauthClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        mockConfig,
        expect.objectContaining({
          scope: 'openid name email',
          state: 'state-abc',
          code_challenge: 'challenge',
          code_challenge_method: 'S256',
          response_mode: 'form_post',
        })
      )
      expect(url).toBe(expectedUrl)
    })

    it('should generate and use Apple client secret for discovery', async () => {
      const oauthClient = makeMockClient()
      const provider = new AppleProvider(providerConfig, oauthClient)

      await provider.getAuthorizationURL('state', 'verifier')

      expect(oauthClient.generateAppleClientSecret).toHaveBeenCalledWith(
        providerConfig.teamId,
        providerConfig.clientId,
        providerConfig.keyId,
        providerConfig.privateKey
      )
      expect(oauthClient.discovery).toHaveBeenCalledWith(
        new URL('https://appleid.apple.com'),
        providerConfig.clientId,
        'mock-client-secret-jwt',
        mockClientAuth
      )
    })

    it('should cache client secret and config across calls', async () => {
      const oauthClient = makeMockClient()
      const provider = new AppleProvider(providerConfig, oauthClient)

      await provider.getAuthorizationURL('state1', 'verifier1')
      await provider.getAuthorizationURL('state2', 'verifier2')

      expect(oauthClient.generateAppleClientSecret).toHaveBeenCalledTimes(1)
      expect(oauthClient.discovery).toHaveBeenCalledTimes(1)
    })
  })

  describe('exchangeCode', () => {
    it('should exchange code and return OAuthTokens', async () => {
      const oauthClient = makeMockClient({
        authorizationCodeGrant: jest.fn().mockResolvedValue({
          access_token: 'apple-token',
          id_token: 'apple-id-token',
          expires_in: 3600,
        }),
      })
      const provider = new AppleProvider(providerConfig, oauthClient)

      const result = await provider.exchangeCode('auth-code', 'verifier-xyz')

      expect(oauthClient.authorizationCodeGrant).toHaveBeenCalledWith(mockConfig, expect.any(URL), {
        pkceCodeVerifier: 'verifier-xyz',
        expectedState: skipStateCheck,
      })
      expect(result).toEqual({
        accessToken: 'apple-token',
        idToken: 'apple-id-token',
        expiresIn: 3600,
      })
    })
  })

  describe('getUserProfile', () => {
    it('should return normalized OAuthUserProfile from OIDC userinfo', async () => {
      const oauthClient = makeMockClient({
        fetchUserInfo: jest.fn().mockResolvedValue({
          sub: 'apple-user-123',
          email: 'user@privaterelay.appleid.com',
          email_verified: true,
        }),
      })
      const provider = new AppleProvider(providerConfig, oauthClient)

      const result = await provider.getUserProfile({ accessToken: 'token' })

      expect(result).toEqual({
        providerId: 'apple-user-123',
        provider: 'apple',
        email: 'user@privaterelay.appleid.com',
        emailVerified: true,
        displayName: null,
        avatarUrl: null,
      })
    })

    it('should always return null for displayName (name sent only on first login)', async () => {
      const oauthClient = makeMockClient({
        fetchUserInfo: jest.fn().mockResolvedValue({
          sub: 'apple-user-123',
          email: 'user@example.com',
          email_verified: true,
          name: 'Should Be Ignored',
        }),
      })
      const provider = new AppleProvider(providerConfig, oauthClient)

      const result = await provider.getUserProfile({ accessToken: 'token' })

      expect(result.displayName).toBeNull()
      expect(result.avatarUrl).toBeNull()
    })
  })
})
