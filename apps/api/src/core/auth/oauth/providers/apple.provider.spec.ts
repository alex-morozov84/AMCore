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
    enableNonRepudiationChecks: jest.fn(),
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
          claims: () => ({
            sub: 'apple-user-123',
            email: 'user@example.com',
            email_verified: true,
          }),
        }),
      })
      const provider = new AppleProvider(providerConfig, oauthClient)

      const result = await provider.exchangeCode('auth-code', 'verifier-xyz')

      expect(oauthClient.authorizationCodeGrant).toHaveBeenCalledWith(mockConfig, expect.any(URL), {
        pkceCodeVerifier: 'verifier-xyz',
        expectedState: skipStateCheck,
        idTokenExpected: true,
      })
      expect(result).toEqual({
        accessToken: 'apple-token',
        idToken: 'apple-id-token',
        expiresIn: 3600,
        verifiedIdentity: {
          providerId: 'apple-user-123',
          email: 'user@example.com',
          emailVerified: true,
        },
      })
    })
  })

  describe('verified identity profile', () => {
    it('requires verified exchange claims and never calls UserInfo', async () => {
      const oauthClient = makeMockClient()
      const provider = new AppleProvider(providerConfig, oauthClient)
      expect(() => provider.getUserProfile({ accessToken: 'unverified' })).toThrow(
        'Verified Apple identity required'
      )
      const result = await provider.getUserProfile({
        accessToken: '',
        verifiedIdentity: {
          providerId: 'apple-user-123',
          email: 'user@example.com',
          emailVerified: true,
        },
      })
      expect(result).toEqual({
        providerId: 'apple-user-123',
        provider: 'apple',
        email: 'user@example.com',
        emailVerified: true,
        displayName: null,
        avatarSourceUrl: null,
      })
      expect(oauthClient.fetchUserInfo).not.toHaveBeenCalled()
    })

    it.each([false, 'false', undefined])(
      'does not treat %p as a verified email',
      async (verified) => {
        const oauthClient = makeMockClient({
          authorizationCodeGrant: jest.fn().mockResolvedValue({
            access_token: 'token',
            id_token: 'verified-token',
            claims: () => ({ sub: 'subject', email: 'user@example.com', email_verified: verified }),
          }),
        })
        const provider = new AppleProvider(providerConfig, oauthClient)
        const tokens = await provider.exchangeCode('code', 'verifier')
        expect(tokens.verifiedIdentity?.emailVerified).toBe(false)
        expect(oauthClient.enableNonRepudiationChecks).toHaveBeenCalledWith(mockConfig)
      }
    )

    it.each([undefined, {}, { sub: 3 }, { sub: 'subject', email_verified: 1 }])(
      'rejects absent or malformed verified claims: %p',
      async (claims) => {
        const oauthClient = makeMockClient({
          authorizationCodeGrant: jest.fn().mockResolvedValue({
            access_token: 'token',
            claims: () => claims,
          }),
        })
        await expect(
          new AppleProvider(providerConfig, oauthClient).exchangeCode('code', 'verifier')
        ).rejects.toThrow()
      }
    )
  })
})
