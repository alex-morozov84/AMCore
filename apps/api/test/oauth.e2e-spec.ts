import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import type { OAuthTokens, OAuthUserProfile } from '@amcore/shared'

import { OAuthStateService } from '../src/core/auth/oauth/oauth-state.service'
import { OAuthProviderFactory } from '../src/core/auth/oauth/providers/oauth-provider.factory'
import type { OAuthProvider } from '../src/core/auth/oauth/providers/oauth-provider.interface'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

/**
 * Mock OAuth provider registered under 'google' name
 * so OAuthAccount rows use the valid Prisma enum value GOOGLE.
 */
function createMockProvider(profile?: Partial<OAuthUserProfile>): OAuthProvider {
  const defaultProfile: OAuthUserProfile = {
    providerId: 'oauth-uid-123',
    provider: 'google',
    email: 'oauth-user@example.com',
    emailVerified: true,
    displayName: 'OAuth User',
    avatarUrl: null,
    ...profile,
  }

  return {
    name: 'google',
    getAuthorizationURL: async (state: string): Promise<URL> =>
      new URL(`https://mock-oauth.example.com/authorize?state=${state}`),
    exchangeCode: async (): Promise<OAuthTokens> => ({ accessToken: 'mock-access-token' }),
    getUserProfile: async (): Promise<OAuthUserProfile> => defaultProfile,
  }
}

function extractRefreshCookie(header: string | string[] | undefined): string {
  const cookies = Array.isArray(header) ? header : header ? [header] : []
  const refreshCookie = cookies.find((cookie) => cookie.startsWith('refresh_token='))
  if (!refreshCookie) throw new Error('refresh_token cookie not found')
  return refreshCookie.split(';')[0]!
}

function extractTicket(location: string | undefined): string {
  if (!location) throw new Error('redirect location not found')
  const url = new URL(location)
  const ticket = url.searchParams.get('ticket')
  if (!ticket) throw new Error('ticket not found in redirect URL')
  return ticket
}

describe('OAuth (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext | undefined
  let stateService: OAuthStateService
  let providerFactory: OAuthProviderFactory

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    stateService = app.get(OAuthStateService)
    providerFactory = app.get(OAuthProviderFactory)
  }, 120000)

  afterAll(async () => {
    if (context) {
      await teardownE2ETest(context)
    }
  })

  beforeEach(async () => {
    await cleanDatabase(prisma, context!.cache, context!.throttlerStorage)
    // Inject mock provider under 'google' name
    ;(providerFactory as unknown as { providers: Map<string, OAuthProvider> }).providers.set(
      'google',
      createMockProvider()
    )
  })

  describe('GET /auth/oauth/providers', () => {
    it('should return list of configured providers', async () => {
      const res = await request(app.getHttpServer()).get('/auth/oauth/providers').expect(200)

      expect(res.body.providers).toContain('google')
    })
  })

  describe('GET /auth/oauth/:provider', () => {
    it('should redirect to provider authorization URL', async () => {
      const res = await request(app.getHttpServer()).get('/auth/oauth/google').expect(302)

      expect(res.headers.location).toContain('mock-oauth.example.com/authorize')
      expect(res.headers.location).toContain('state=')
    })

    it('should return 400 for unconfigured provider', async () => {
      await request(app.getHttpServer()).get('/auth/oauth/nonexistent').expect(400)
    })
  })

  describe('GET /auth/oauth/:provider/callback', () => {
    it('should return 400 when code is missing', async () => {
      await request(app.getHttpServer())
        .get('/auth/oauth/google/callback?state=some-state')
        .expect(400)
    })

    it('should return 400 when state is missing', async () => {
      await request(app.getHttpServer())
        .get('/auth/oauth/google/callback?code=some-code')
        .expect(400)
    })

    it('should return 400 when state is invalid', async () => {
      await request(app.getHttpServer())
        .get('/auth/oauth/google/callback?code=some-code&state=invalid-state')
        .expect(400)
    })

    it('should create new user and redirect on valid callback', async () => {
      const state = 'valid-state-new-user'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'test-verifier',
        mode: 'login',
      })

      const res = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      // Should redirect to frontend with a one-time login ticket, never an access token.
      expect(res.headers.location).toContain('/auth/callback?ticket=')
      expect(res.headers.location).not.toContain('token=')

      // User should be created in database
      const user = await prisma.user.findUnique({
        where: { email: 'oauth-user@example.com' },
        include: { accounts: true },
      })
      expect(user).toBeDefined()
      expect(user!.emailVerified).toBe(true)
      expect(user!.name).toBe('OAuth User')
      expect(user!.accounts).toHaveLength(1)
      expect(user!.accounts[0]!.provider).toBe('GOOGLE')
      expect(user!.accounts[0]!.providerAccountId).toBe('oauth-uid-123')
    })

    it('should set refresh_token cookie on successful callback', async () => {
      const state = 'valid-state-cookie'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'test-verifier',
        mode: 'login',
      })

      const res = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const cookies = res.headers['set-cookie'] as unknown as string[]
      const refreshCookie = cookies.find((c) => c.startsWith('refresh_token='))
      expect(refreshCookie).toBeDefined()
      expect(refreshCookie).toContain('HttpOnly')
      expect(refreshCookie).toContain('Path=/')
    })

    it('should exchange valid ticket with refresh cookie for access token', async () => {
      const state = 'valid-state-exchange'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'test-verifier',
        mode: 'login',
      })

      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const ticket = extractTicket(callbackRes.headers.location)
      const refreshCookie = extractRefreshCookie(callbackRes.headers['set-cookie'])

      const exchangeRes = await request(app.getHttpServer())
        .post('/auth/oauth/exchange')
        .set('Cookie', refreshCookie)
        .send({ ticket })
        .expect(200)

      expect(exchangeRes.body.accessToken).toEqual(expect.any(String))
      expect(exchangeRes.body.accessToken.split('.')).toHaveLength(3)
    })

    it('should reject replay of the same ticket', async () => {
      const state = 'valid-state-ticket-replay'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'test-verifier',
        mode: 'login',
      })

      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const ticket = extractTicket(callbackRes.headers.location)
      const refreshCookie = extractRefreshCookie(callbackRes.headers['set-cookie'])

      await request(app.getHttpServer())
        .post('/auth/oauth/exchange')
        .set('Cookie', refreshCookie)
        .send({ ticket })
        .expect(200)

      await request(app.getHttpServer())
        .post('/auth/oauth/exchange')
        .set('Cookie', refreshCookie)
        .send({ ticket })
        .expect(401)
    })

    it('should reject exchange without refresh cookie', async () => {
      const state = 'valid-state-no-cookie'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'test-verifier',
        mode: 'login',
      })

      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const ticket = extractTicket(callbackRes.headers.location)

      await request(app.getHttpServer()).post('/auth/oauth/exchange').send({ ticket }).expect(401)
    })

    it('should reject invalid ticket', async () => {
      const state = 'valid-state-invalid-ticket'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'test-verifier',
        mode: 'login',
      })

      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const refreshCookie = extractRefreshCookie(callbackRes.headers['set-cookie'])

      await request(app.getHttpServer())
        .post('/auth/oauth/exchange')
        .set('Cookie', refreshCookie)
        .send({ ticket: 'invalid-ticket' })
        .expect(401)
    })

    it('should reject missing or already consumed ticket', async () => {
      const state = 'valid-state-consumed-ticket'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'test-verifier',
        mode: 'login',
      })

      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const ticket = extractTicket(callbackRes.headers.location)
      const refreshCookie = extractRefreshCookie(callbackRes.headers['set-cookie'])

      await request(app.getHttpServer())
        .post('/auth/oauth/exchange')
        .set('Cookie', refreshCookie)
        .send({ ticket })
        .expect(200)

      await request(app.getHttpServer())
        .post('/auth/oauth/exchange')
        .set('Cookie', refreshCookie)
        .send({ ticket })
        .expect(401)
    })

    it('should login existing OAuth user without creating duplicate', async () => {
      // First login — creates user
      const state1 = 'valid-state-first'
      await stateService.store(state1, {
        provider: 'google',
        codeVerifier: 'verifier-1',
        mode: 'login',
      })
      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state1}`)
        .expect(302)

      // Second login — same OAuth account
      const state2 = 'valid-state-second'
      await stateService.store(state2, {
        provider: 'google',
        codeVerifier: 'verifier-2',
        mode: 'login',
      })
      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state2}`)
        .expect(302)

      // Should still have only one user and one OAuth account
      const users = await prisma.user.findMany()
      expect(users).toHaveLength(1)

      const accounts = await prisma.oAuthAccount.findMany()
      expect(accounts).toHaveLength(1)
    })

    it('should link OAuth account to existing user with same email', async () => {
      // Register user with password first
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'oauth-user@example.com', password: 'StrongP@ss123' })
        .expect(201)

      // OAuth login with same email — should link, not create new user
      const state = 'valid-state-link'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'verifier',
        mode: 'login',
      })
      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const users = await prisma.user.findMany()
      expect(users).toHaveLength(1)

      const accounts = await prisma.oAuthAccount.findMany()
      expect(accounts).toHaveLength(1)
      expect(accounts[0]!.userId).toBe(users[0]!.id)
    })

    it('should verify email when OAuth provider confirms it', async () => {
      // Register user (emailVerified = false)
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'oauth-user@example.com', password: 'StrongP@ss123' })
        .expect(201)

      const userBefore = await prisma.user.findUnique({
        where: { email: 'oauth-user@example.com' },
      })
      expect(userBefore!.emailVerified).toBe(false)

      // OAuth login with emailVerified: true — should update user
      const state = 'valid-state-verify'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'verifier',
        mode: 'login',
      })
      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      const userAfter = await prisma.user.findUnique({
        where: { email: 'oauth-user@example.com' },
      })
      expect(userAfter!.emailVerified).toBe(true)
    })

    it('should return 400 when provider returns no email', async () => {
      ;(providerFactory as unknown as { providers: Map<string, OAuthProvider> }).providers.set(
        'google',
        createMockProvider({ email: null })
      )

      const state = 'valid-state-no-email'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'verifier',
        mode: 'login',
      })

      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(400)
    })

    it('should return 400 when state provider does not match URL', async () => {
      // Store state for 'github' but call callback for 'google'
      const state = 'valid-state-mismatch'
      await stateService.store(state, {
        provider: 'github',
        codeVerifier: 'verifier',
        mode: 'login',
      })

      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(400)
    })

    it('should prevent state replay (one-time use)', async () => {
      const state = 'valid-state-replay'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'verifier',
        mode: 'login',
      })

      // First use — success
      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      // Second use — state already consumed
      await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(400)
    })

    it('should keep link flow redirect unchanged', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'link-flow@example.com',
          emailVerified: true,
          name: 'Link Flow User',
        },
      })

      const state = 'valid-state-link-flow'
      await stateService.store(state, {
        provider: 'google',
        codeVerifier: 'verifier',
        mode: 'link',
        userId: user.id,
      })

      const res = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=auth-code&state=${state}`)
        .expect(302)

      expect(res.headers.location).toContain('/settings/linked-accounts?linked=google')
      expect(res.headers.location).not.toContain('ticket=')
      expect(res.headers.location).not.toContain('token=')
    })
  })
})
