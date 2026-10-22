import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from 'jose'

import { OAuthClientService } from '../oauth-client.service.js'

import { AppleProvider } from './apple.provider.js'

const issuer = 'https://appleid.apple.com'
const clientId = 'com.example.test-service'
const verifier = 'v'.repeat(43)
const callbacks = [
  'https://shop.example.test/api/v1/auth/oauth/apple/callback',
  'https://manage.example.test/api/v1/auth/oauth/apple/callback',
]

describe('Apple verified-token protocol with the real OIDC client', () => {
  let signing: Awaited<ReturnType<typeof generateKeyPair>>
  let wrongSigning: Awaited<ReturnType<typeof generateKeyPair>>
  let privateKey: string
  let fetchSpy: jest.SpyInstance

  beforeAll(async () => {
    signing = await generateKeyPair('RS256', { extractable: true })
    wrongSigning = await generateKeyPair('RS256')
    const secret = await generateKeyPair('ES256', { extractable: true })
    privateKey = await exportPKCS8(secret.privateKey)
  })
  afterEach(() => fetchSpy?.mockRestore())

  async function fixture(callback: string, scenario = 'valid', verified: boolean | string = true) {
    const jwk = { ...(await exportJWK(signing.publicKey)), kid: 'test-key', alg: 'RS256' }
    const calls: string[] = []
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: scenario === 'issuer' ? 'https://wrong.example.test' : issuer,
      aud: scenario === 'audience' ? 'other-client' : clientId,
      sub: scenario === 'subject' ? '' : 'apple-test-subject',
      iat: now,
      exp: scenario === 'expired' ? now - 300 : now + 300,
      email: 'apple-user@example.test',
      email_verified: scenario === 'claim-type' ? 123 : verified,
    }
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(scenario === 'signature' ? wrongSigning.privateKey : signing.privateKey)
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push(url)
      if (url === `${issuer}/.well-known/openid-configuration`) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/auth/authorize`,
          token_endpoint: `${issuer}/auth/token`,
          jwks_uri: `${issuer}/auth/keys`,
          response_types_supported: ['code'],
          subject_types_supported: ['pairwise'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
        })
      }
      if (url === `${issuer}/auth/keys`) return Response.json({ keys: [jwk] })
      if (url === `${issuer}/auth/token`) {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('redirect_uri')).toBe(callback)
        expect(body.get('code_verifier')).toBe(verifier)
        expect(body.get('grant_type')).toBe('authorization_code')
        return Response.json({
          access_token: '<fake-test-access-token>',
          token_type: 'Bearer',
          expires_in: 3600,
          ...(scenario === 'missing' ? {} : { id_token: token }),
        })
      }
      throw new Error(`Unexpected Apple protocol endpoint: ${url}`)
    })
    const provider = new AppleProvider(
      {
        clientId,
        clientSecret: '',
        redirectUri: callback,
        teamId: 'TESTTEAM',
        keyId: 'TESTKEY',
        privateKey,
      },
      new OAuthClientService()
    )
    return { provider, calls }
  }

  it.each(callbacks)(
    'validates signature and builds profile without UserInfo at %s',
    async (callback) => {
      const { provider, calls } = await fixture(callback)
      const authorization = await provider.getAuthorizationURL('state', verifier)
      expect(authorization.searchParams.get('response_mode')).toBe('form_post')
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      const tokens = await provider.exchangeCode('test-code', verifier)
      expect(await provider.getUserProfile(tokens)).toEqual({
        provider: 'apple',
        providerId: 'apple-test-subject',
        email: 'apple-user@example.test',
        emailVerified: true,
        displayName: null,
        avatarSourceUrl: null,
      })
      expect(calls).toContain(`${issuer}/auth/keys`)
      expect(calls.every((url) => !url.includes('userinfo'))).toBe(true)
    }
  )

  it.each(['signature', 'issuer', 'audience', 'expired', 'missing', 'subject', 'claim-type'])(
    'rejects %s before a verified identity can be returned',
    async (scenario) => {
      const { provider } = await fixture(callbacks[0]!, scenario)
      await expect(provider.exchangeCode('test-code', verifier)).rejects.toThrow()
    }
  )

  it.each([true, false, 'true', 'false'])(
    'interprets verified-email claim %s exactly',
    async (verified) => {
      const { provider } = await fixture(callbacks[0]!, 'valid', verified)
      const profile = await provider.getUserProfile(
        await provider.exchangeCode('test-code', verifier)
      )
      expect(profile.emailVerified).toBe(verified === true || verified === 'true')
    }
  )
})
