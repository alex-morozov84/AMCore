import { randomBytes, randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import { generate } from 'otplib'
import request from 'supertest'

import { BROWSER_AUTH_HEADERS, DEFAULT_LOCALE, localePathPrefix } from '@amcore/shared'

import { MfaAuthorityReader } from '../src/core/auth/mfa/mfa-authority-reader.service.js'
import { MfaEncryptionService } from '../src/core/auth/mfa/mfa-encryption.service.js'
import {
  backupCodeHash,
  generateBackupCodes,
  mfaCredential,
} from '../src/core/auth/mfa/mfa-secrets.js'
import { createTotpSecret } from '../src/core/auth/mfa/mfa-totp.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { OAuthLoginTicketService } from '../src/core/auth/oauth/oauth-login-ticket.service.js'
import { hashOAuthStateNonce } from '../src/core/auth/oauth/oauth-nonce.js'
import { OAuthStateService } from '../src/core/auth/oauth/oauth-state.service.js'
import { OAuthProviderFactory } from '../src/core/auth/oauth/providers/oauth-provider.factory.js'
import type { OAuthProvider } from '../src/core/auth/oauth/providers/oauth-provider.interface.js'
import { TokenService } from '../src/core/auth/token.service.js'
import { TokenManagerService } from '../src/core/auth/token-manager.service.js'
import { invitationSecretHash } from '../src/core/invitations/invitation-credential.js'
import { EnvService } from '../src/env/env.service.js'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers.js'

const password = '<fake-valid-http-password-Long123!>'
const key = '<fake-password-http-browser-transport-key-at-least-32>'
const email = 'mfa.password.http@example.test'
const pendingCall = (context: E2ETestContext, path: string, continuation: string) =>
  request(context.app.getHttpServer())
    .post(`/auth/mfa/${path}`)
    .set('x-mfa-continuation', continuation)

describe('Actual password, MFA proof and credential publication HTTP path', () => {
  let context: E2ETestContext
  beforeAll(async () => {
    context = await setupE2ETest()
    const env = context.app.get(EnvService)
    const get = env.get.bind(env)
    const config = {
      WEB_FRONTEND_CONTEXT_KEY: key,
      MFA_ACTIVE_KEY_ID: 'http-fixture',
      MFA_ENCRYPTION_KEYS: JSON.stringify({
        'http-fixture': Buffer.alloc(32, 7).toString('base64'),
      }),
    }
    jest
      .spyOn(env, 'get')
      .mockImplementation((name) =>
        name in config ? (config[name as keyof typeof config] as never) : get(name)
      )
  }, 120000)
  afterAll(async () => {
    jest.restoreAllMocks()
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    await context.prisma.browserAuthContext.deleteMany()
    await context.prisma.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform' },
      update: { state: 'prepared', version: 1 },
    })
  })
  const login = () => request(context.app.getHttpServer()).post('/auth/login')
  const me = (accessToken: string) =>
    request(context.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
  async function register() {
    const response = await request(context.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    return response.body.user.id as string
  }
  async function registrationProposal() {
    const bootstrap = await request(context.app.getHttpServer())
      .post('/auth/browser-publications/bootstrap')
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, 'product')
      .send({})
      .expect(200)
    const intent = {
      continuation: mfaCredential(),
      vaultBinding: mfaCredential(),
      operationId: randomUUID(),
    }
    return {
      intent,
      headers: {
        [BROWSER_AUTH_HEADERS.key]: key,
        [BROWSER_AUTH_HEADERS.audience]: 'product',
        [BROWSER_AUTH_HEADERS.binding]: bootstrap.body.binding,
        [BROWSER_AUTH_HEADERS.contextId]: bootstrap.body.view.contextId,
        [BROWSER_AUTH_HEADERS.generation]: String(bootstrap.body.view.generation),
        'x-mfa-continuation': intent.continuation,
        'x-mfa-vault-binding': intent.vaultBinding,
        'x-amcore-login-attempt': intent.operationId,
      },
    }
  }
  it('browser registration commits account, pending family/session and verification token before exact publication', async () => {
    const { intent, headers } = await registrationProposal()
    const created = await request(context.app.getHttpServer())
      .post('/auth/register')
      .set(headers)
      .send({ email, password })
      .expect(201)
    expect(created.body.publication).toMatchObject({
      continuation: intent.continuation,
      operationId: intent.operationId,
    })
    expect(await context.prisma.session.count({ where: { userId: created.body.user.id } })).toBe(1)
    expect(
      await context.prisma.authSessionFamily.findUnique({
        where: { id: created.body.publication.familyId },
      })
    ).toMatchObject({ publicationState: 'pending' })
    expect(
      await context.prisma.emailVerificationToken.count({ where: { userId: created.body.user.id } })
    ).toBe(1)
    headers[BROWSER_AUTH_HEADERS.generation] = String(created.body.publication.browser.generation)
    await me(created.body.accessToken).set(headers).expect(401)
    await pendingCall(context, 'publication/acknowledge', intent.continuation)
      .set(headers)
      .send({
        purpose: 'login',
        operationId: intent.operationId,
        vaultBinding: intent.vaultBinding,
        receipt: null,
        accessToken: created.body.accessToken,
      })
      .expect(200)
    await me(created.body.accessToken).set(headers).expect(200)
  })
  it('browser registration rolls every authority write back when verification-token creation fails', async () => {
    const { headers } = await registrationProposal()
    const failure = jest
      .spyOn(context.app.get(TokenManagerService), 'generateEmailVerificationToken')
      .mockRejectedValueOnce(new Error('fake-registration-token-failure'))
    await request(context.app.getHttpServer())
      .post('/auth/register')
      .set(headers)
      .send({ email, password })
      .expect(500)
    failure.mockRestore()
    expect(await context.prisma.user.count({ where: { emailCanonical: email } })).toBe(0)
    expect(await context.prisma.session.count()).toBe(0)
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
    expect(await context.prisma.mfaFlow.count()).toBe(0)
    expect(
      await context.prisma.browserAuthContext.findUnique({
        where: { id: headers[BROWSER_AUTH_HEADERS.contextId] },
      })
    ).toMatchObject({ generation: 0, state: 'empty' })
  })
  it.each(['/auth/register', '/auth/invites/register'])(
    'invited browser registration atomically publishes its handoff without membership through %s',
    async (path) => {
      const { intent, headers } = await registrationProposal()
      const org = await context.prisma.organization.create({
        data: { name: 'Registration invitation', slug: randomUUID() },
      })
      const role = await context.prisma.role.create({
        data: { name: 'Recipient', organizationId: org.id },
      })
      const expiresAt = new Date((await mfaDatabaseClock(context.prisma)).getTime() + 900000)
      const invite = await context.prisma.orgInvite.create({
        data: {
          organizationId: org.id,
          email,
          emailCanonical: email,
          tokenHash: randomUUID(),
          expiresAt,
          roleIntents: {
            create: {
              ordinal: 0,
              requestedRoleId: role.id,
              liveRoleId: role.id,
              roleNameAtIssue: role.name,
            },
          },
        },
      })
      const credential = mfaCredential(),
        handoff = { attemptId: randomBytes(16).toString('base64url'), cleanupKey: mfaCredential() }
      await context.prisma.invitationContinuation.create({
        data: {
          credentialHash: invitationSecretHash(credential),
          inviteId: invite.id,
          generation: invite.generation,
          expiresAt,
        },
      })
      const created = await request(context.app.getHttpServer())
        .post(path)
        .set(headers)
        .set('x-invitation-continuation', credential)
        .set('x-invitation-auth-attempt-id', handoff.attemptId)
        .set('x-invitation-handoff-key', handoff.cleanupKey)
        .send(path === '/auth/register' ? { email, password } : { password })
        .expect(201)
      expect(await context.prisma.session.count({ where: { userId: created.body.user.id } })).toBe(
        1
      )
      expect(
        await context.prisma.emailVerificationToken.count({
          where: { userId: created.body.user.id },
        })
      ).toBe(1)
      headers[BROWSER_AUTH_HEADERS.generation] = String(created.body.publication.browser.generation)
      await me(created.body.accessToken).set(headers).expect(401)
      const acknowledgement = {
        purpose: 'login',
        operationId: intent.operationId,
        vaultBinding: intent.vaultBinding,
        receipt: null,
        accessToken: created.body.accessToken,
      }
      await pendingCall(context, 'publication/acknowledge', intent.continuation)
        .set(headers)
        .send(acknowledgement)
        .expect(409)
      await request(context.app.getHttpServer())
        .post('/auth/browser-publications/invitation-confirm')
        .set(headers)
        .unset('x-mfa-continuation')
        .send({ ...acknowledgement, handoff })
        .expect(401)
      await request(context.app.getHttpServer())
        .post('/auth/browser-publications/invitation-confirm')
        .set(headers)
        .set('x-mfa-continuation', intent.continuation)
        .send({ ...acknowledgement, handoff })
        .expect(200)
      await me(created.body.accessToken).set(headers).expect(200)
      expect(
        await context.prisma.orgMember.count({ where: { userId: created.body.user.id } })
      ).toBe(0)
    }
  )
  async function enrolled() {
    const id = await register()
    const db = context.prisma
    await db.user.update({ where: { id }, data: { systemRole: 'SUPER_ADMIN' } })
    // Active data is an isolated post-start fixture. This does not prove deployment startup/activation.
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'active' } })
    await db.mfaAccount.create({
      data: {
        userId: id,
        required: true,
        setupComplete: true,
        securityVersion: 1,
        codeGeneration: 1,
      },
    })
    const factorId = randomUUID()
    const { secret } = createTotpSecret(email)
    const encrypted = context.app.get(MfaEncryptionService).encrypt(id, factorId, secret)
    await db.mfaFactor.create({ data: { id: factorId, userId: id, ...encrypted } })
    const code = generateBackupCodes()[0]!
    await db.mfaRecoveryCode.create({
      data: { userId: id, generation: 1, hash: backupCodeHash(id, 1, code) },
    })
    return { id, secret, code }
  }

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'invitation issues only a pending family and uses combined publication (protected=%s, oauth=%s)',
    async (protectedAccount, oauth) => {
      const f = protectedAccount ? await enrolled() : { id: await register(), secret: '' }
      const org = await context.prisma.organization.create({
        data: { name: 'HTTP invitation', slug: randomUUID() },
      })
      const role = await context.prisma.role.create({
        data: { name: 'HTTP recipient', organizationId: org.id },
      })
      const expiresAt = new Date((await mfaDatabaseClock(context.prisma)).getTime() + 900_000)
      const invite = await context.prisma.orgInvite.create({
        data: {
          organizationId: org.id,
          email,
          emailCanonical: email,
          tokenHash: randomUUID(),
          expiresAt,
          roleIntents: {
            create: {
              ordinal: 0,
              requestedRoleId: role.id,
              liveRoleId: role.id,
              roleNameAtIssue: role.name,
            },
          },
        },
      })
      const credential = mfaCredential()
      await context.prisma.invitationContinuation.create({
        data: {
          credentialHash: invitationSecretHash(credential),
          inviteId: invite.id,
          generation: invite.generation,
          expiresAt,
        },
      })
      const bootstrap = await request(context.app.getHttpServer())
        .post('/auth/browser-publications/bootstrap')
        .set(BROWSER_AUTH_HEADERS.key, key)
        .set(BROWSER_AUTH_HEADERS.audience, 'product')
        .send({})
        .expect(200)
      const headers = {
        [BROWSER_AUTH_HEADERS.key]: key,
        [BROWSER_AUTH_HEADERS.audience]: 'product',
        [BROWSER_AUTH_HEADERS.binding]: bootstrap.body.binding,
        [BROWSER_AUTH_HEADERS.contextId]: bootstrap.body.view.contextId,
        [BROWSER_AUTH_HEADERS.generation]: String(bootstrap.body.view.generation),
      }
      const handoff = {
        attemptId: randomBytes(16).toString('base64url'),
        cleanupKey: mfaCredential(),
      }
      const beforeAuthSessions = await context.prisma.session.count()
      let started: request.Response
      if (oauth) {
        await context.prisma.oAuthAccount.create({
          data: { userId: f.id, provider: 'GOOGLE', providerAccountId: 'invited-http-provider' },
        })
        const provider: OAuthProvider = {
          name: 'google',
          getAuthorizationURL: async (state) =>
            new URL(`https://provider.example.test?state=${state}`),
          exchangeCode: async () => ({ accessToken: '<fake-invited-provider-access>' }),
          getUserProfile: async () => ({
            provider: 'google',
            providerId: 'invited-http-provider',
            email,
            emailVerified: true,
            displayName: null,
            avatarSourceUrl: null,
          }),
        }
        const factory = context.app.get(OAuthProviderFactory) as unknown as {
          providers: Map<string, OAuthProvider>
        }
        factory.providers.set('google', provider)
        const attempt = randomUUID()
        const authorize = await request(context.app.getHttpServer())
          .get('/auth/oauth/google')
          .set(headers)
          .set('x-amcore-oauth-attempt', attempt)
          .set('x-invitation-attempt-id', handoff.attemptId)
          .set('x-invitation-auth-attempt-id', handoff.attemptId)
          .set('x-invitation-handoff-key', handoff.cleanupKey)
          .set('x-invitation-continuation', credential)
          .expect(302)
        const state = new URL(authorize.headers.location!).searchParams.get('state')!
        const nonce = (authorize.headers['set-cookie'] as unknown as string[])
          .find((value) => value.startsWith('oauth_state='))!
          .split(';')[0]!
        const callback = await request(context.app.getHttpServer())
          .get(`/auth/oauth/google/callback?code=fake-invited-code&state=${state}`)
          .set('Cookie', nonce)
          .expect(302)
        const ticket = new URL(callback.headers.location!).searchParams.get('ticket')!
        const cookie = (callback.headers['set-cookie'] as unknown as string[])
          .find((value) => value.startsWith('refresh_token='))!
          .split(';')[0]!
        started = await request(context.app.getHttpServer())
          .post('/auth/oauth/exchange')
          .set(headers)
          .set('x-amcore-oauth-attempt', attempt)
          .set('Cookie', cookie)
          .send({ ticket })
          .expect(202)
      } else
        started = await login()
          .set(headers)
          .set('x-invitation-auth-attempt-id', handoff.attemptId)
          .set('x-invitation-handoff-key', handoff.cleanupKey)
          .set('x-invitation-continuation', credential)
          .send({ email, password })
          .expect(202)
      expect(await context.prisma.session.count()).toBe(beforeAuthSessions)
      expect(started.body.state).toBe(
        protectedAccount ? (oauth ? 'password_required' : 'verify_required') : 'ready'
      )
      expect(await context.prisma.invitationAuthHandoff.count()).toBe(0)
      headers[BROWSER_AUTH_HEADERS.generation] = String(started.body.browser.generation)
      let factorOutcome: unknown
      if (protectedAccount) {
        if (oauth)
          await pendingCall(context, 'password', started.body.continuation)
            .set(headers)
            .send({ purpose: 'login', operationId: randomUUID(), password })
            .expect(200)
        const clock = await mfaDatabaseClock(context.prisma)
        const code = await generate({ secret: f.secret, epoch: Math.floor(clock.getTime() / 1000) })
        const verified = await pendingCall(context, 'verify', started.body.continuation)
          .set(headers)
          .send({ purpose: 'login', operationId: randomUUID(), proof: { method: 'totp', code } })
          .expect(200)
        factorOutcome = verified.body.outcome
      }
      expect(factorOutcome).toBe(protectedAccount ? 'verified' : undefined)
      const operationId = randomUUID(),
        vaultBinding = mfaCredential()
      const issued = await pendingCall(context, 'complete', started.body.continuation)
        .set(headers)
        .send({ purpose: 'login', operationId, vaultBinding })
        .expect(200)
      expect(
        await context.prisma.invitationAuthHandoff.findUnique({
          where: { attemptId: handoff.attemptId },
        })
      ).toMatchObject({ status: 'pending' })
      await me(issued.body.accessToken).set(headers).expect(401)
      const body = {
        purpose: 'login',
        operationId,
        vaultBinding,
        accessToken: issued.body.accessToken,
        receipt: issued.body.publication.receipt,
      }
      await pendingCall(context, 'publication/acknowledge', started.body.continuation)
        .set(headers)
        .send(body)
        .expect(409)
      await request(context.app.getHttpServer())
        .post('/auth/browser-publications/invitation-confirm')
        .set(headers)
        .set('x-mfa-continuation', started.body.continuation)
        .send({ ...body, handoff })
        .expect(200)
      await me(issued.body.accessToken).set(headers).expect(200)
      expect(await context.prisma.orgMember.count({ where: { userId: f.id } })).toBe(0)
      const repeat = await pendingCall(context, 'complete', started.body.continuation)
        .set(headers)
        .send({ purpose: 'login', operationId, vaultBinding })
        .expect(202)
      expect(repeat.body).toMatchObject({ kind: 'issued', status: { state: 'published' } })
      expect(repeat.headers['set-cookie']).toBeUndefined()
    }
  )

  it('OAuth exchange binds the exact private browser attempt, callback nonce and account version', async () => {
    const id = await register()
    const bootstrap = await request(context.app.getHttpServer())
      .post('/auth/browser-publications/bootstrap')
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, 'product')
      .send({})
      .expect(200)
    const headers = {
      [BROWSER_AUTH_HEADERS.key]: key,
      [BROWSER_AUTH_HEADERS.audience]: 'product',
      [BROWSER_AUTH_HEADERS.binding]: bootstrap.body.binding,
      [BROWSER_AUTH_HEADERS.contextId]: bootstrap.body.view.contextId,
      [BROWSER_AUTH_HEADERS.generation]: String(bootstrap.body.view.generation),
    }
    const attemptId = randomUUID()
    const binding = '2'.repeat(64)
    const identity = {
      userId: id,
      emailCanonical: email,
      systemRole: 'USER' as const,
      securityVersion: 0,
      protectedAccount: false,
      verifiedAt: (await mfaDatabaseClock(context.prisma)).toISOString(),
      eventId: randomUUID(),
    }
    const issue = () =>
      context.app.get(OAuthLoginTicketService).issue({
        userId: id,
        email,
        systemRole: 'USER',
        sessionId: '',
        identity,
        browserAttemptId: attemptId,
        exchangeBindingHash: context.app.get(TokenService).hashRefreshToken(binding),
      })
    const exchange = (ticket: string, attempt = attemptId, cookie = binding) =>
      request(context.app.getHttpServer())
        .post('/auth/oauth/exchange')
        .set(headers)
        .set('x-amcore-oauth-attempt', attempt)
        .set('Cookie', `refresh_token=${cookie}`)
        .send({ ticket })
    await exchange(await issue(), randomUUID()).expect(401)
    await exchange(await issue(), attemptId, '3'.repeat(64)).expect(401)
    expect(await context.prisma.mfaFlow.count()).toBe(0)
    const response = await exchange(await issue()).expect(202)
    expect(response.body).toMatchObject({
      state: 'ready',
      nextAction: 'complete',
      browser: { contextId: bootstrap.body.view.contextId, generation: 1 },
    })
    expect(response.body).not.toHaveProperty('accessToken')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
    headers[BROWSER_AUTH_HEADERS.generation] = '1'
    await context.prisma.mfaAccount.update({
      where: { userId: id },
      data: { securityVersion: { increment: 1 } },
    })
    await exchange(await issue()).expect(401)
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
  })

  it('OAuth callback issues no session; protected exchange requires local password and TOTP before publication', async () => {
    const f = await enrolled()
    await context.prisma.oAuthAccount.create({
      data: { userId: f.id, provider: 'GOOGLE', providerAccountId: 'mfa-http-provider' },
    })
    const provider: OAuthProvider = {
      name: 'google',
      getAuthorizationURL: async () => new URL('https://provider.example.test'),
      exchangeCode: async () => ({ accessToken: '<fake-provider-access>' }),
      getUserProfile: async () => ({
        provider: 'google',
        providerId: 'mfa-http-provider',
        email,
        emailVerified: true,
        displayName: null,
        avatarSourceUrl: null,
      }),
    }
    const factory = context.app.get(OAuthProviderFactory) as unknown as {
      providers: Map<string, OAuthProvider>
    }
    factory.providers.set('google', provider)
    const nonce = '<fake-oauth-http-nonce>'
    const state = randomUUID()
    await context.app.get(OAuthStateService).store(state, {
      provider: 'google',
      codeVerifier: '<fake-verifier>',
      mode: 'login',
      browserNonceHash: hashOAuthStateNonce(nonce),
    })
    const before = await context.prisma.session.count()
    const callback = await request(context.app.getHttpServer())
      .get(`/auth/oauth/google/callback?code=fake-code&state=${state}`)
      .set('Cookie', `oauth_state=${nonce}`)
      .expect(302)
    expect(await context.prisma.session.count()).toBe(before)
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
    const cookie = (callback.headers['set-cookie'] as unknown as string[])
      .find((value) => value.startsWith('refresh_token='))!
      .split(';')[0]!
    const ticket = new URL(callback.headers.location!).searchParams.get('ticket')!
    const exchange = await request(context.app.getHttpServer())
      .post('/auth/oauth/exchange')
      .set('Cookie', cookie)
      .send({ ticket })
      .expect(202)
    expect(exchange.body).toMatchObject({
      state: 'password_required',
      requiredProofs: ['password', 'second_factor'],
    })
    expect(exchange.body).not.toHaveProperty('accessToken')
    expect(exchange.headers['set-cookie']).toBeUndefined()
    const { continuation } = exchange.body
    await pendingCall(context, 'password', continuation)
      .send({ purpose: 'login', operationId: randomUUID(), password })
      .expect(200)
      .expect(({ body }) => expect(body.requiredProofs).toEqual(['second_factor']))
    const clock = await mfaDatabaseClock(context.prisma)
    const code = await generate({ secret: f.secret, epoch: Math.floor(clock.getTime() / 1000) })
    await pendingCall(context, 'verify', continuation)
      .send({ purpose: 'login', operationId: randomUUID(), proof: { method: 'totp', code } })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('verified'))
    const operationId = randomUUID()
    const issued = await pendingCall(context, 'complete', continuation)
      .send({ purpose: 'login', operationId, vaultBinding: null })
      .expect(200)
    await me(issued.body.accessToken).expect(409)
    await pendingCall(context, 'publication/acknowledge', continuation)
      .send({
        purpose: 'login',
        operationId,
        vaultBinding: null,
        accessToken: issued.body.accessToken,
        receipt: issued.body.publication.receipt,
      })
      .expect(200)
    await me(issued.body.accessToken).expect(200)
    await request(context.app.getHttpServer())
      .post('/auth/oauth/exchange')
      .set('Cookie', cookie)
      .send({ ticket })
      .expect(401)
  })

  it('requires local password in an identity-only continuation without publishing a session', async () => {
    const f = await enrolled()
    const started = await login().send({ email, password }).expect(202)
    const flow = await context.prisma.mfaFlow.findFirstOrThrow({ where: { userId: f.id } })
    await context.prisma.mfaFlow.update({
      where: { id: flow.id },
      data: {
        primaryAt: null,
        data: {
          identity: {
            method: 'oauth',
            eventId: randomUUID(),
            verifiedAt: new Date().toISOString(),
            securityVersion: 1,
          },
          proofs: { primary: null, secondFactor: null },
        },
      },
    })
    const { continuation } = started.body
    await pendingCall(context, 'status', continuation)
      .send({ purpose: 'login' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          state: 'password_required',
          requiredProofs: ['password', 'second_factor'],
        })
      )
    const command = { purpose: 'login', operationId: randomUUID(), password }
    await pendingCall(context, 'password', continuation)
      .set('Authorization', 'Bearer <fake-token>')
      .send(command)
      .expect(403)
    await pendingCall(context, 'password', continuation)
      .send({ ...command, operationId: randomUUID(), password: '<fake-wrong-password>' })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('wrong_password'))
    const response = await pendingCall(context, 'password', continuation).send(command).expect(200)
    expect(response.body).toEqual({ outcome: 'verified', requiredProofs: ['second_factor'] })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
    const before = await context.prisma.mfaFlow.findUniqueOrThrow({ where: { id: flow.id } })
    await pendingCall(context, 'password', continuation).send(command).expect(200)
    expect(
      (await context.prisma.mfaFlow.findUniqueOrThrow({ where: { id: flow.id } })).data
    ).toEqual(before.data)
    await pendingCall(context, 'password', continuation)
      .send({ ...command, purpose: 'rotate_codes' })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('restart_required'))
    await context.prisma.mfaAccount.update({
      where: { userId: f.id },
      data: { securityVersion: { increment: 1 } },
    })
    await pendingCall(context, 'password', continuation)
      .send({ ...command, operationId: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('restart_required'))
  })

  it('retains ordinary independent API login without MFA or publication acknowledgement', async () => {
    const id = await register()
    const response = await login().send({ email, password }).expect(200)
    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'user'])
    expect(response.body.user.lastLoginAt).toEqual(expect.any(String))
    expect(response.headers['cache-control']).toBe('private, no-store')
    await me(response.body.accessToken).expect(200)
    expect(
      await context.prisma.authSessionFamily.findFirst({ where: { userId: id } })
    ).toMatchObject({ publicationState: 'published', browserContextId: null })
    expect(response.headers['set-cookie']).toBeDefined()
  })

  it('refuses an operator in prepared rather than issuing a password-only session', async () => {
    const id = await register()
    await context.prisma.user.update({ where: { id }, data: { systemRole: 'SUPER_ADMIN' } })
    const before = await context.prisma.session.count()
    const response = await login().send({ email, password }).expect(503)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(await context.prisma.session.count()).toBe(before)
    expect(await context.prisma.mfaFlow.count()).toBe(0)
  })

  it.each(['totp', 'recovery_code'] as const)(
    'requires %s, retains pending credentials, acknowledges once, and denies replay',
    async (method) => {
      const f = await enrolled()
      const started = await login().send({ email, password }).expect(202)
      expect(started.body).toMatchObject({
        kind: 'mfa',
        state: 'verify_required',
        nextAction: 'verify',
        browser: null,
      })
      expect(started.body.accessToken).toBeUndefined()
      expect(started.body.user).toBeUndefined()
      expect(started.headers['set-cookie']).toBeUndefined()
      expect(await context.prisma.authSessionFamily.count()).toBe(0)
      const { continuation } = started.body
      const status = await pendingCall(context, 'status', continuation)
        .send({ purpose: 'login' })
        .expect(200)
      expect(status.body).toMatchObject({
        kind: 'mfa',
        state: 'verify_required',
        requiredProofs: ['second_factor'],
      })
      expect(Object.keys(status.body).sort()).toEqual([
        'expiresAt',
        'generation',
        'kind',
        'purpose',
        'remainingCodes',
        'requiredProofs',
        'state',
      ])
      await pendingCall(context, 'status', continuation)
        .send({ purpose: 'rotate_codes' })
        .expect(401)
      const early = await pendingCall(context, 'complete', continuation)
        .send({ purpose: 'login', operationId: randomUUID(), vaultBinding: null })
        .expect(202)
      expect(early.body).toEqual({ kind: 'proof_required', requiredProofs: ['second_factor'] })
      const clock = await mfaDatabaseClock(context.prisma)
      const proof = {
        method,
        code:
          method === 'totp'
            ? await generate({ secret: f.secret, epoch: Math.floor(clock.getTime() / 1000) })
            : f.code,
      }
      const verifyId = randomUUID()
      const verifyBody = { purpose: 'login', operationId: verifyId, proof }
      await pendingCall(context, 'verify', continuation)
        .send(verifyBody)
        .expect(200)
        .expect(({ body }) => expect(body.outcome).toBe('verified'))
      await pendingCall(context, 'verify', continuation).send(verifyBody).expect(200)
      await pendingCall(context, 'status', continuation)
        .send({ purpose: 'login' })
        .expect(200)
        .expect(({ body }) => expect(body.state).toBe('ready'))
      const operationId = randomUUID()
      const completeBody = { purpose: 'login', operationId, vaultBinding: null }
      const issued = await pendingCall(context, 'complete', continuation)
        .send(completeBody)
        .expect(200)
      await me(issued.body.accessToken).expect(409)
      const repeated = await pendingCall(context, 'complete', continuation)
        .send(completeBody)
        .expect(202)
      expect(repeated.body).toMatchObject({ kind: 'issued', status: { state: 'pending' } })
      expect(repeated.headers['set-cookie']).toBeUndefined()
      const ack = {
        ...completeBody,
        accessToken: issued.body.accessToken,
        receipt: issued.body.publication.receipt,
      }
      await pendingCall(context, 'publication/acknowledge', continuation)
        .send({ ...ack, receipt: mfaCredential() })
        .expect(409)
      await pendingCall(context, 'publication/acknowledge', continuation).send(ack).expect(200)
      await pendingCall(context, 'publication/acknowledge', continuation).send(ack).expect(200)
      await me(issued.body.accessToken).expect(200)
      expect(await context.prisma.authSessionFamily.count()).toBe(1)
      const second = await login().send({ email, password }).expect(202)
      const replay = await pendingCall(context, 'verify', second.body.continuation)
        .send({ purpose: 'login', operationId: randomUUID(), proof })
        .expect(200)
      expect(replay.body.outcome).toBe('wrong_code')
      expect(
        await context.prisma.mfaRecoveryCode.count({
          where: { userId: f.id, consumedAt: { not: null } },
        })
      ).toBe(method === 'recovery_code' ? 1 : 0)
    }
  )

  it('reserves and publishes an ordinary browser family without a human MFA receipt', async () => {
    await register()
    const bootstrap = await request(context.app.getHttpServer())
      .post('/auth/browser-publications/bootstrap')
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, 'product')
      .send({})
      .expect(200)
    const headers = {
      [BROWSER_AUTH_HEADERS.key]: key,
      [BROWSER_AUTH_HEADERS.audience]: 'product',
      [BROWSER_AUTH_HEADERS.binding]: bootstrap.body.binding,
      [BROWSER_AUTH_HEADERS.contextId]: bootstrap.body.view.contextId,
      [BROWSER_AUTH_HEADERS.generation]: String(bootstrap.body.view.generation),
    }
    const vaultBinding = mfaCredential()
    const started = await login().set(headers).send({ email, password }).expect(202)
    expect(started.body).toMatchObject({ state: 'ready', nextAction: 'complete' })
    expect(started.headers['set-cookie']).toBeUndefined()
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
    headers[BROWSER_AUTH_HEADERS.generation] = String(started.body.browser.generation)
    const issued = await pendingCall(context, 'complete', started.body.continuation)
      .set(headers)
      .send({ purpose: 'login', operationId: randomUUID(), vaultBinding })
      .expect(200)
    const publication = issued.body.publication
    expect(publication.receipt).toBeNull()
    await me(issued.body.accessToken).set(headers).expect(401)
    await pendingCall(context, 'publication/acknowledge', publication.continuation)
      .set(headers)
      .send({
        purpose: 'login',
        operationId: publication.operationId,
        vaultBinding,
        accessToken: issued.body.accessToken,
        receipt: null,
      })
      .expect(200)
    const admission = jest.spyOn(context.app.get(MfaAuthorityReader), 'admitProjection')
    const access = await me(issued.body.accessToken).set(headers)
    const checkedBinding = admission.mock.calls.at(-1)?.[2]
    admission.mockRestore()
    expect({ status: access.status, binding: checkedBinding }).toEqual({
      status: 200,
      binding: expect.objectContaining({
        contextId: publication.browser.contextId,
        generation: publication.browser.generation,
      }),
    })
    await me(issued.body.accessToken).expect(401)
  })

  it('rejects mixed, wrong-purpose and oversized continuation commands without consuming the backup code', async () => {
    const f = await enrolled()
    const started = await login().send({ email, password }).expect(202)
    const body = {
      purpose: 'login',
      operationId: randomUUID(),
      proof: { method: 'recovery_code', code: f.code },
    }
    for (const [name, value] of [
      ['Authorization', 'Bearer fake'],
      ['Cookie', 'refresh_token=fake'],
      ['x-api-key', 'fake'],
    ])
      await pendingCall(context, 'verify', started.body.continuation)
        .set(name!, value!)
        .send(body)
        .expect(403)
    const wrong = await pendingCall(context, 'verify', started.body.continuation)
      .send({ ...body, purpose: 'rotate_codes' })
      .expect(200)
    expect(wrong.body.outcome).toBe('restart_required')
    await pendingCall(context, 'verify?code=forged', started.body.continuation)
      .send(body)
      .expect(400)
    await pendingCall(context, 'verify', started.body.continuation)
      .send({ ...body, padding: 'x'.repeat(4096) })
      .expect(413)
    expect(
      await context.prisma.mfaRecoveryCode.count({ where: { userId: f.id, consumedAt: null } })
    ).toBe(1)
  })

  it('protected OAuth attachment returns to login and old HTTP authority cannot survive', async () => {
    const f = await enrolled()
    const started = await login().send({ email, password }).expect(202)
    const continuation = started.body.continuation
    await pendingCall(context, 'verify', continuation)
      .send({
        purpose: 'login',
        operationId: randomUUID(),
        proof: { method: 'recovery_code', code: f.code },
      })
      .expect(200)
    const complete = { purpose: 'login', operationId: randomUUID(), vaultBinding: null }
    const issued = await pendingCall(context, 'complete', continuation).send(complete).expect(200)
    await pendingCall(context, 'publication/acknowledge', continuation)
      .send({
        ...complete,
        accessToken: issued.body.accessToken,
        receipt: issued.body.publication.receipt,
      })
      .expect(200)
    await me(issued.body.accessToken).expect(200)
    const provider: OAuthProvider = {
      name: 'google',
      getAuthorizationURL: async (state) => new URL(`https://provider.example.test?state=${state}`),
      exchangeCode: async () => ({ accessToken: '<fake-link-http-token>' }),
      getUserProfile: async () => ({
        provider: 'google',
        providerId: 'protected-link-http',
        email,
        emailVerified: true,
        displayName: null,
        avatarSourceUrl: null,
      }),
    }
    const factory = context.app.get(OAuthProviderFactory) as unknown as {
      providers: Map<string, OAuthProvider>
    }
    factory.providers.set('google', provider)
    const before = await context.prisma.mfaAccount.findUniqueOrThrow({ where: { userId: f.id } })
    const count = await context.prisma.session.count()
    const initiated = await request(context.app.getHttpServer())
      .get('/auth/oauth/google/link')
      .auth(issued.body.accessToken, { type: 'bearer' })
      .expect(302)
    const state = new URL(initiated.headers.location!).searchParams.get('state')!
    const nonce = (initiated.headers['set-cookie'] as unknown as string[])
      .find((value) => value.startsWith('oauth_state='))!
      .split(';')[0]!
    const callback = await request(context.app.getHttpServer())
      .get(`/auth/oauth/google/callback?state=${state}&code=fake-link-code`)
      .set('Cookie', nonce)
      .expect(302)
    expect(new URL(callback.headers.location!).pathname).toBe(
      `${localePathPrefix(DEFAULT_LOCALE)}/login`
    )
    expect(new URL(callback.headers.location!).searchParams.get('linked')).toBe('google')
    expect(callback.headers['set-cookie']).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^refresh_token=[^;]/)])
    )
    expect(await context.prisma.session.count()).toBe(count)
    expect(
      await context.prisma.mfaAccount.findUniqueOrThrow({ where: { userId: f.id } })
    ).toMatchObject({ securityVersion: before.securityVersion + 1 })
    await me(issued.body.accessToken).expect(409)
    const again = await login().send({ email, password }).expect(202)
    expect(again.body.requiredProofs).toContain('second_factor')
    expect(again.body.accessToken).toBeUndefined()
  })
})
