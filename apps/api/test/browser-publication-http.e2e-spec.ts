import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import request from 'supertest'

import { BROWSER_AUTH_HEADERS } from '@amcore/shared'

import { hashBrowserBinding } from '../src/core/auth/mfa/browser-binding.js'
import { MfaEncryptionService } from '../src/core/auth/mfa/mfa-encryption.service.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { TokenService } from '../src/core/auth/token.service.js'
import { EnvService } from '../src/env/env.service.js'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers.js'
import { pendingPublication } from './mfa-publication.fixture.js'

const key = '<fake-browser-http-private-transport-key-at-least-32>'
const root = '/auth/browser-publications'
describe('Actual private browser credential HTTP routes with dormant MFA', () => {
  let context: E2ETestContext
  beforeAll(async () => {
    context = await setupE2ETest()
    const env = context.app.get(EnvService)
    const get = env.get.bind(env)
    jest
      .spyOn(env, 'get')
      .mockImplementation((name) =>
        name === 'WEB_FRONTEND_CONTEXT_KEY' ? (key as never) : get(name)
      )
  }, 120000)
  afterAll(async () => {
    jest.restoreAllMocks()
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    await context.prisma.browserAuthContext.deleteMany()
  })
  const call = (path: string) =>
    request(context.app.getHttpServer())
      .post(root + path)
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, 'product')

  async function invitationCandidate() {
    const handoffKey = mfaCredential()
    const f = await pendingPublication(
      { clients: [context.prisma], codec: context.app.get(MfaEncryptionService) },
      {
        invitation: true,
        handoffKey,
      }
    )
    const binding = mfaCredential()
    const bindingHash = hashBrowserBinding(binding)!
    await context.prisma.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { bindingHash },
    })
    await context.prisma.mfaFlow.update({ where: { id: f.flow.id }, data: { bindingHash } })
    const tokens = context.app.get(TokenService)
    const token = tokens.generateAccessToken(f.claims)
    const body = {
      purpose: 'login',
      operationId: f.command.operationId,
      vaultBinding: f.command.vaultBinding,
      accessToken: token,
      receipt: null,
      handoff: { attemptId: f.record.invitation!.attemptId, cleanupKey: handoffKey },
    }
    const headers = {
      [BROWSER_AUTH_HEADERS.key]: key,
      [BROWSER_AUTH_HEADERS.audience]: 'product',
      [BROWSER_AUTH_HEADERS.binding]: binding,
      [BROWSER_AUTH_HEADERS.contextId]: f.requestBinding.contextId,
      [BROWSER_AUTH_HEADERS.generation]: '1',
      'x-mfa-continuation': f.command.continuation,
    }
    return { f, body, headers, token, tokens }
  }

  it('confirms handoff and publishes ordinary browser authority atomically without prior bearer admission or membership', async () => {
    const { f, body, headers, token } = await invitationCandidate()
    const ordinary = { ...headers }
    delete (ordinary as Record<string, string>)['x-mfa-continuation']
    await request(context.app.getHttpServer())
      .get('/auth/me')
      .set(ordinary)
      .set('Authorization', `Bearer ${token}`)
      .expect(401)
    await request(context.app.getHttpServer())
      .post(`/auth/invites/auth-handoffs/${body.handoff.attemptId}/confirm`)
      .set(ordinary)
      .set('Authorization', `Bearer ${token}`)
      .set('x-invitation-handoff-key', body.handoff.cleanupKey)
      .send({})
      .expect(401)
    const first = await request(context.app.getHttpServer())
      .post(root + '/invitation-confirm')
      .set(headers)
      .send(body)
      .expect(200)
    expect(first.body).toEqual({ outcome: 'published' })
    expect(first.headers['set-cookie']).toBeUndefined()
    await request(context.app.getHttpServer())
      .post(root + '/invitation-confirm')
      .set(headers)
      .send(body)
      .expect(200)
    await request(context.app.getHttpServer())
      .get('/auth/me')
      .set(ordinary)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(
      await context.prisma.invitationAuthHandoff.findUnique({
        where: { attemptId: body.handoff.attemptId },
      })
    ).toMatchObject({ status: 'confirmed' })
    expect(
      await context.prisma.authSessionFamily.findUnique({ where: { id: f.family.id } })
    ).toMatchObject({ publicationState: 'published' })
    expect(await context.prisma.orgMember.count({ where: { userId: f.user.id } })).toBe(0)
    expect(await context.prisma.session.count({ where: { userId: f.user.id } })).toBe(1)
  })

  it.each(['sid', 'fid', 'generation', 'key', 'expiry'] as const)(
    'refuses changed invitation publication %s without either commit',
    async (changed) => {
      const { f, body, headers, tokens } = await invitationCandidate()
      if (changed === 'sid' || changed === 'fid')
        body.accessToken = tokens.generateAccessToken({ ...f.claims, [changed]: randomUUID() })
      if (changed === 'generation') headers[BROWSER_AUTH_HEADERS.generation] = '2'
      if (changed === 'key') body.handoff.cleanupKey = mfaCredential()
      if (changed === 'expiry')
        await context.prisma.invitationAuthHandoff.update({
          where: { attemptId: body.handoff.attemptId },
          data: { deadline: new Date(0) },
        })
      await request(context.app.getHttpServer())
        .post(root + '/invitation-confirm')
        .set(headers)
        .send(body)
        .expect(409)
      expect(
        await context.prisma.invitationAuthHandoff.findUnique({
          where: { attemptId: body.handoff.attemptId },
        })
      ).toMatchObject({ status: 'pending' })
      expect(
        await context.prisma.authSessionFamily.findUnique({ where: { id: f.family.id } })
      ).toMatchObject({ publicationState: 'pending' })
    }
  )

  it('bootstraps separately, returns existing neutral status without a binding, and issues no cookie', async () => {
    const first = await call('/bootstrap').send({}).expect(200)
    expect(first.body.kind).toBe('created')
    expect(first.headers['set-cookie']).toBeUndefined()
    expect(first.headers['cache-control']).toBe('private, no-store')
    const existing = await call('/bootstrap').send({ binding: first.body.binding }).expect(200)
    expect(existing.body).toEqual({ kind: 'existing', view: first.body.view })
    expect(existing.headers['set-cookie']).toBeUndefined()
    await call('/status').send({ binding: first.body.binding }).expect(200)
    expect(await context.prisma.user.count()).toBe(0)
    expect(await context.prisma.session.count()).toBe(0)
  })

  it('rejects absent/wrong transport and mixed ordinary credentials before creating an anchor', async () => {
    await request(context.app.getHttpServer())
      .post(root + '/bootstrap')
      .send({})
      .expect(403)
    await call('/bootstrap').set(BROWSER_AUTH_HEADERS.key, '<fake-wrong-key>').send({}).expect(403)
    for (const [name, value] of [
      ['Authorization', 'Bearer fake'],
      ['Cookie', 'refresh_token=fake'],
      ['x-api-key', 'fake'],
    ])
      await call('/bootstrap').set(name!, value!).send({}).expect(403)
    expect(await context.prisma.browserAuthContext.count()).toBe(0)
  })

  it('enforces strict JSON/query/decoded-body limits and closes error responses', async () => {
    await call('/bootstrap').send({ userId: 'forged-user' }).expect(400)
    const query = await call('/bootstrap?binding=fake-query-secret').send({}).expect(400)
    expect(query.headers['cache-control']).toBe('private, no-store')
    expect(query.headers['referrer-policy']).toBe('no-referrer')
    await call('/bootstrap').type('form').send('binding=fake').expect(415)
    const large = await call('/bootstrap')
      .send({ padding: 'x'.repeat(4096) })
      .expect(413)
    expect(large.headers['cache-control']).toBe('private, no-store')
    expect(await context.prisma.browserAuthContext.count()).toBe(0)
  })

  it('checks actual refresh/binding publication while retaining normal ordinary-user access', async () => {
    const { prisma } = context
    const registered = await request(context.app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'probe.http@example.test', password: '<fake-valid-password-Long123!>' })
      .expect(201)
    const cookie = (registered.headers['set-cookie'] as unknown as string[]).find((value) =>
      value.startsWith('refresh_token=')
    )!
    const raw = cookie.split(';')[0]!.slice('refresh_token='.length)
    const userId = registered.body.user.id as string
    const session = await prisma.session.findFirstOrThrow({ where: { userId } })
    const anchor = await call('/bootstrap').send({}).expect(200)
    const now = await mfaDatabaseClock(prisma)
    await prisma.mfaAccount.create({ data: { userId } })
    await prisma.authSessionFamily.create({
      data: {
        id: session.familyId,
        userId,
        securityVersion: 0,
        primaryMethod: 'password',
        primaryAt: now,
        primaryProofId: randomUUID(),
        publicationState: 'published',
        browserContextId: anchor.body.view.contextId,
        publicationGeneration: 0,
        expiresAt: session.expiresAt,
      },
    })
    await prisma.browserAuthContext.update({
      where: { id: anchor.body.view.contextId },
      data: {
        state: 'published',
        currentFamilyId: session.familyId,
        expiresAt: session.expiresAt,
      },
    })
    const probe = () =>
      call('/probe')
        .set(BROWSER_AUTH_HEADERS.binding, anchor.body.binding)
        .set(BROWSER_AUTH_HEADERS.contextId, anchor.body.view.contextId)
        .set(BROWSER_AUTH_HEADERS.generation, '0')
        .send({ refreshToken: raw, familyId: session.familyId, securityVersion: 0 })
    const current = await probe().expect(200)
    expect(current.body).toMatchObject({ status: 'current', userId, familyId: session.familyId })
    expect(current.body.accessToken).toBeUndefined()
    expect(current.headers['set-cookie']).toBeUndefined()
    await prisma.authSessionFamily.update({
      where: { id: session.familyId },
      data: { revokedAt: now },
    })
    const changed = await probe().expect(401)
    expect(changed.body.errorCode).toBe('AUTH_CONTEXT_CHANGED')
    expect(changed.headers['cache-control']).toBe('private, no-store')
  })
})
