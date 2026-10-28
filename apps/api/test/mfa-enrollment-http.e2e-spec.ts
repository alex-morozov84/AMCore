import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import { generate } from 'otplib'
import request from 'supertest'

import { BROWSER_AUTH_HEADERS } from '@amcore/shared'

import { MfaOfflineRecovery } from '../src/core/auth/mfa/mfa-offline-recovery.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { MfaSecurityEvents } from '../src/core/auth/mfa/mfa-security-events.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { EnvService } from '../src/env/env.service.js'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers.js'

const key = '<fake-enrollment-http-private-transport-key-at-least-32>'
const email = 'enrollment.http@example.test',
  password = '<fake-enrollment-password-Long123!>'

describe('Actual restricted enrollment HTTP and one-time setup transfer', () => {
  let context: E2ETestContext
  beforeAll(async () => {
    context = await setupE2ETest()
    const env = context.app.get(EnvService),
      get = env.get.bind(env)
    const config = {
      WEB_FRONTEND_CONTEXT_KEY: key,
      MFA_ACTIVE_KEY_ID: 'enrollment-fixture',
      MFA_ENCRYPTION_KEYS: JSON.stringify({
        'enrollment-fixture': Buffer.alloc(32, 8).toString('base64'),
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
  })
  const command = (path: string, continuation: string, headers: Record<string, string>) =>
    request(context.app.getHttpServer())
      .post(`/auth/mfa/${path}`)
      .set(headers)
      .set('x-mfa-continuation', continuation)

  async function initial(audience: 'product' | 'console' = 'product') {
    const registered = await request(context.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    await context.prisma.user.update({
      where: { id: registered.body.user.id },
      data: { systemRole: 'SUPER_ADMIN' },
    })
    // Isolated post-start active data proves transport, not deployment startup/activation.
    await context.prisma.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', state: 'active' },
      update: { state: 'active', version: 1 },
    })
    const bootstrap = await request(context.app.getHttpServer())
      .post('/auth/browser-publications/bootstrap')
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, audience)
      .send({})
      .expect(200)
    const headers = {
      [BROWSER_AUTH_HEADERS.key]: key,
      [BROWSER_AUTH_HEADERS.audience]: audience,
      [BROWSER_AUTH_HEADERS.binding]: bootstrap.body.binding as string,
      [BROWSER_AUTH_HEADERS.contextId]: bootstrap.body.view.contextId as string,
      [BROWSER_AUTH_HEADERS.generation]: String(bootstrap.body.view.generation),
    }
    const start = await request(context.app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send({ email, password })
      .expect(202)
    headers[BROWSER_AUTH_HEADERS.generation] = String(start.body.browser.generation)
    return {
      userId: registered.body.user.id as string,
      headers,
      continuation: start.body.continuation as string,
    }
  }
  it('refuses ordinary-account Console login before creating a flow or publication', async () => {
    await request(context.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    const bootstrap = await request(context.app.getHttpServer())
      .post('/auth/browser-publications/bootstrap')
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, 'console')
      .send({})
      .expect(200)
    const before = {
      families: await context.prisma.authSessionFamily.count(),
      flows: await context.prisma.mfaFlow.count(),
    }
    await request(context.app.getHttpServer())
      .post('/auth/login')
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, 'console')
      .set(BROWSER_AUTH_HEADERS.binding, bootstrap.body.binding)
      .set(BROWSER_AUTH_HEADERS.contextId, bootstrap.body.view.contextId)
      .set(BROWSER_AUTH_HEADERS.generation, String(bootstrap.body.view.generation))
      .send({ email, password })
      .expect(401)
    expect(await context.prisma.authSessionFamily.count()).toBe(before.families)
    expect(await context.prisma.mfaFlow.count()).toBe(before.flows)
  })

  it('rechecks Console operator role before issuing an already configured successor', async () => {
    const f = await initial('console')
    const draft = await command('enrollment', f.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID() })
      .expect(200)
    const code = await generate({
      secret: draft.body.enrollment.secret,
      epoch: Math.floor((await mfaDatabaseClock(context.prisma)).getTime() / 1000),
    })
    const bound = await command('bind-factor', f.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: randomUUID(),
        proof: { method: 'totp', code },
      })
      .expect(200)
    const successor = bound.body.successor
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(successor.browser.generation)
    await command('acknowledge-codes', successor.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: randomUUID(),
        generation: successor.backupCodes.generation,
      })
      .expect(200)
    await context.prisma.user.update({ where: { id: f.userId }, data: { systemRole: 'USER' } })
    const denied = await command('complete', successor.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID(), vaultBinding: mfaCredential() })
      .expect(202)
    expect(denied.body.kind).toBe('restart_required')
    expect(denied.body).not.toHaveProperty('accessToken')
    expect(denied.headers['set-cookie']).toBeUndefined()
    expect(
      await context.prisma.authSessionFamily.count({ where: { userId: f.userId, revokedAt: null } })
    ).toBe(0)
  })

  it('binds a new app, acknowledges saved codes, and grants access only after exact publication', async () => {
    const f = await initial()
    await command('status', f.continuation, f.headers)
      .send({ purpose: 'initial_setup' })
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('enrollment_required'))
    const draft = await command('enrollment', f.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID() })
      .expect(200)
    expect(draft.body.outcome).toBe('seed')
    const wrong = await command('bind-factor', f.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: randomUUID(),
        proof: { method: 'recovery_code', code: 'f'.repeat(32) },
      })
      .expect(200)
    expect(wrong.body).toEqual({ outcome: 'wrong_code' })
    expect(await context.prisma.mfaFactor.count()).toBe(0)
    const now = await mfaDatabaseClock(context.prisma)
    const code = await generate({
      secret: draft.body.enrollment.secret,
      epoch: Math.floor(now.getTime() / 1000),
    })
    const bindId = randomUUID()
    const bound = await command('bind-factor', f.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: bindId, proof: { method: 'totp', code } })
      .expect(200)
    expect(bound.body.outcome).toBe('bound')
    const successor = bound.body.successor
    expect(successor.backupCodes.codes).toHaveLength(10)
    expect(successor.continuation).not.toBe(f.continuation)
    expect(bound.headers['set-cookie']).toBeUndefined()
    expect(bound.body).not.toHaveProperty('accessToken')
    await command('bind-factor', f.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: bindId, proof: { method: 'totp', code } })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ outcome: 'restart_required' }))
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(successor.browser.generation)
    await command('status', successor.continuation, f.headers)
      .send({ purpose: 'initial_setup' })
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('codes_pending'))
    const operationId = randomUUID(),
      vaultBinding = mfaCredential()
    await command('complete', successor.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId, vaultBinding })
      .expect(202)
      .expect(({ body }) => expect(body.kind).toBe('enrollment_required'))
    const ackId = randomUUID()
    await command('acknowledge-codes', successor.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: ackId,
        generation: successor.backupCodes.generation + 1,
      })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('generation_changed'))
    const ack = {
      purpose: 'initial_setup',
      operationId: randomUUID(),
      generation: successor.backupCodes.generation,
    }
    await command('acknowledge-codes', successor.continuation, f.headers).send(ack).expect(200)
    await command('acknowledge-codes', successor.continuation, f.headers).send(ack).expect(200)
    const issued = await command('complete', successor.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId, vaultBinding })
      .expect(200)
    const me = () =>
      request(context.app.getHttpServer())
        .get('/auth/me')
        .set(f.headers)
        .set('Authorization', `Bearer ${issued.body.accessToken}`)
    await me().expect(401)
    await command('publication/acknowledge', successor.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId,
        vaultBinding,
        accessToken: issued.body.accessToken,
        receipt: issued.body.publication.receipt,
      })
      .expect(200)
    await me().expect(200)
    expect(
      await context.prisma.mfaAccount.findUnique({ where: { userId: f.userId } })
    ).toMatchObject({ setupComplete: true, securityVersion: 1 })
    // A source-session continuation retains this F and browser generation; it cannot issue another F.
    const familyId = issued.body.publication.familyId as string
    const stale = new Date((await mfaDatabaseClock(context.prisma)).getTime() - 601_000)
    await context.prisma.authSessionFamily.update({
      where: { id: familyId },
      data: { mfaAt: stale },
    })
    const startSession = (body: object, token = issued.body.accessToken as string) =>
      request(context.app.getHttpServer())
        .post('/auth/mfa/session-flow')
        .set(f.headers)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
    const sourceFlow = await startSession({
      purpose: 'reauthenticate',
      operationId: randomUUID(),
    }).expect(200)
    expect(sourceFlow.body).toMatchObject({
      kind: 'mfa',
      state: 'verify_required',
      requiredProofs: ['second_factor'],
      browser: {
        contextId: f.headers[BROWSER_AUTH_HEADERS.contextId],
        generation: Number(f.headers[BROWSER_AUTH_HEADERS.generation]),
      },
    })
    const reauthId = randomUUID()
    const reauth = () =>
      command('reauthenticate', sourceFlow.body.continuation, f.headers).send({
        purpose: 'reauthenticate',
        operationId: reauthId,
      })
    await reauth()
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('proof_required'))
    await command('verify', sourceFlow.body.continuation, f.headers)
      .send({
        purpose: 'reauthenticate',
        operationId: randomUUID(),
        proof: { method: 'recovery_code', code: successor.backupCodes.codes[0] },
      })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('verified'))
    const completed = await reauth().expect(200)
    expect(completed.body).toEqual({ outcome: 'completed', requiredProofs: [] })
    expect(completed.headers['set-cookie']).toBeUndefined()
    await reauth()
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('completed'))
    expect(await context.prisma.authSessionFamily.count({ where: { userId: f.userId } })).toBe(1)
    await startSession({ purpose: 'reauthenticate', operationId: randomUUID(), familyId }).expect(
      400
    )
    await request(context.app.getHttpServer())
      .post('/auth/mfa/session-flow')
      .set(f.headers)
      .set('Authorization', `Bearer ${issued.body.accessToken}`)
      .set('cookie', 'untrusted=value')
      .send({ purpose: 'reauthenticate', operationId: randomUUID() })
      .expect(403)
    const settings = () =>
      request(context.app.getHttpServer())
        .get('/auth/mfa/settings')
        .set(f.headers)
        .set('Authorization', `Bearer ${issued.body.accessToken}`)
    await settings()
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          kind: 'settings',
          accountLabel: email,
          protected: true,
          remainingCodes: 9,
        })
      )
    await settings().query({ userId: 'other-account' }).expect(400)
    await settings().set('cookie', 'untrusted=value').expect(403)
    const rotation = await startSession({
      purpose: 'rotate_codes',
      operationId: randomUUID(),
    }).expect(200)
    const rotationId = randomUUID()
    const rotate = () =>
      command('rotate-codes', rotation.body.continuation, f.headers).send({
        purpose: 'rotate_codes',
        operationId: rotationId,
      })
    const rotated = await rotate().expect(200)
    expect(rotated.body.outcome).toBe('codes')
    expect(rotated.body.backupCodes.codes).toHaveLength(10)
    await rotate()
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          outcome: 'already_generated',
          generation: rotated.body.backupCodes.generation,
        })
      )
    await command('acknowledge-codes', rotation.body.continuation, f.headers)
      .send({
        purpose: 'rotate_codes',
        operationId: randomUUID(),
        generation: rotated.body.backupCodes.generation,
      })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('acknowledged'))
    await settings()
      .expect(200)
      .expect(({ body }) => expect(body.remainingCodes).toBe(10))
    await me().expect(200)
    expect(await context.prisma.authSessionFamily.count({ where: { userId: f.userId } })).toBe(1)
    await context.prisma.authSessionFamily.update({
      where: { id: familyId },
      data: { revokedAt: await mfaDatabaseClock(context.prisma) },
    })
    await reauth()
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('restart_required'))
    await startSession({ purpose: 'reauthenticate', operationId: randomUUID() }).expect(401)
    await settings().expect(401)
    await rotate()
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('restart_required'))
    const durable = JSON.stringify([
      await context.prisma.mfaFlow.findMany(),
      await context.prisma.mfaOperation.findMany(),
      await context.prisma.mfaRecoveryCode.findMany(),
    ])
    for (const secret of [
      draft.body.enrollment.secret,
      successor.continuation,
      ...successor.backupCodes.codes,
    ])
      expect(durable).not.toContain(secret)
  })
  it('replaces an app only from its original family, then publishes only the saved-code successor', async () => {
    const f = await initial()
    const draft = await command('enrollment', f.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID() })
      .expect(200)
    const totp = async (secret: string) =>
      generate({
        secret,
        epoch: Math.floor((await mfaDatabaseClock(context.prisma)).getTime() / 1000),
      })
    const bound = await command('bind-factor', f.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: randomUUID(),
        proof: { method: 'totp', code: await totp(draft.body.enrollment.secret) },
      })
      .expect(200)
    const setup = bound.body.successor
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(setup.browser.generation)
    const publish = async (continuation: string, generation: number) => {
      await command('acknowledge-codes', continuation, f.headers)
        .send({ purpose: 'initial_setup', operationId: randomUUID(), generation })
        .expect(200)
      const operationId = randomUUID(),
        vaultBinding = mfaCredential()
      const issued = await command('complete', continuation, f.headers)
        .send({ purpose: 'initial_setup', operationId, vaultBinding })
        .expect(200)
      await command('publication/acknowledge', continuation, f.headers)
        .send({
          purpose: 'initial_setup',
          operationId,
          vaultBinding,
          accessToken: issued.body.accessToken,
          receipt: issued.body.publication.receipt,
        })
        .expect(200)
      return issued.body.accessToken as string
    }
    const oldToken = await publish(setup.continuation, setup.backupCodes.generation)
    const start = await request(context.app.getHttpServer())
      .post('/auth/mfa/session-flow')
      .set(f.headers)
      .set('authorization', `Bearer ${oldToken}`)
      .send({ purpose: 'replace_factor', operationId: randomUUID() })
      .expect(200)
    const replaceDraft = await command('enrollment', start.body.continuation, f.headers)
      .send({ purpose: 'replace_factor', operationId: randomUUID() })
      .expect(200)
    expect(replaceDraft.body.outcome).toBe('seed')
    expect(replaceDraft.body.enrollment.secret).not.toBe(draft.body.enrollment.secret)
    const replacement = await command('bind-factor', start.body.continuation, f.headers)
      .send({
        purpose: 'replace_factor',
        operationId: randomUUID(),
        proof: { method: 'totp', code: await totp(replaceDraft.body.enrollment.secret) },
      })
      .expect(200)
    expect(replacement.body.outcome).toBe('bound')
    const successor = replacement.body.successor
    await request(context.app.getHttpServer())
      .get('/auth/me')
      .set(f.headers)
      .set('authorization', `Bearer ${oldToken}`)
      .expect(401)
    await command('enrollment', start.body.continuation, f.headers)
      .send({ purpose: 'replace_factor', operationId: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('restart_required'))
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(successor.browser.generation)
    const newToken = await publish(successor.continuation, successor.backupCodes.generation)
    await request(context.app.getHttpServer())
      .get('/auth/me')
      .set(f.headers)
      .set('authorization', `Bearer ${newToken}`)
      .expect(200)
    expect(
      await context.prisma.authSessionFamily.count({ where: { userId: f.userId, revokedAt: null } })
    ).toBe(1)
    expect(
      await context.prisma.mfaAccount.findUnique({ where: { userId: f.userId } })
    ).toMatchObject({ securityVersion: 2, setupComplete: true })
  })
  it('recovers after losing the only successor reply through a new password login and the next unused app step', async () => {
    const f = await initial()
    const draft = await command('enrollment', f.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID() })
      .expect(200)
    const now = await mfaDatabaseClock(context.prisma)
    const code = await generate({
      secret: draft.body.enrollment.secret,
      epoch: Math.floor(now.getTime() / 1000),
    })
    await command('bind-factor', f.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: randomUUID(),
        proof: { method: 'totp', code },
      })
      .expect(200)
    // Neither the successor credential nor plaintext backup set reaches this recovering caller.
    await command('status', f.continuation, f.headers)
      .send({ purpose: 'initial_setup' })
      .expect(401)
    const bootstrap = await request(context.app.getHttpServer())
      .post('/auth/browser-publications/bootstrap')
      .set(BROWSER_AUTH_HEADERS.key, key)
      .set(BROWSER_AUTH_HEADERS.audience, 'product')
      .send({ binding: f.headers[BROWSER_AUTH_HEADERS.binding] })
      .expect(200)
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(bootstrap.body.view.generation)
    const fresh = await request(context.app.getHttpServer())
      .post('/auth/login')
      .set(f.headers)
      .send({ email, password })
      .expect(202)
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(fresh.body.browser.generation)
    const safe = await command('status', fresh.body.continuation, f.headers)
      .send({ purpose: 'initial_setup' })
      .expect(200)
    expect(safe.body).toMatchObject({ state: 'codes_pending', generation: 1 })
    expect(safe.body).not.toHaveProperty('backupCodes')
    const factor = await context.prisma.mfaFactor.findUniqueOrThrow({ where: { userId: f.userId } })
    const nextCode = await generate({
      secret: draft.body.enrollment.secret,
      epoch: Number(factor.lastAcceptedStep + 1n) * 30,
    })
    const operationId = randomUUID(),
      body = { purpose: 'initial_setup', operationId, proof: { method: 'totp', code: nextCode } }
    const recovered = await command('recover-setup-codes', fresh.body.continuation, f.headers)
      .send(body)
      .expect(200)
    expect(recovered.body).toMatchObject({ outcome: 'codes', backupCodes: { generation: 2 } })
    expect(recovered.body.backupCodes.codes).toHaveLength(10)
    await command('recover-setup-codes', fresh.body.continuation, f.headers)
      .send(body)
      .expect(200)
      .expect(({ body: result }) =>
        expect(result).toEqual({ outcome: 'already_generated', generation: 2 })
      )
    await command('acknowledge-codes', fresh.body.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID(), generation: 1 })
      .expect(200)
      .expect(({ body: result }) => expect(result.outcome).toBe('generation_changed'))
    expect(
      await context.prisma.mfaAccount.findUnique({ where: { userId: f.userId } })
    ).toMatchObject({ setupComplete: false, codeGeneration: 2 })
  })
  it('refuses mixed credentials and invalid private browser proof without opening a seed', async () => {
    const f = await initial(),
      body = { purpose: 'initial_setup', operationId: randomUUID() }
    await command('enrollment', f.continuation, f.headers)
      .set('Authorization', 'Bearer <fake-unrelated-token>')
      .send(body)
      .expect(403)
    await command('enrollment', f.continuation, f.headers)
      .set('Cookie', 'fake=unrelated')
      .send(body)
      .expect(403)
    await command('enrollment', f.continuation, f.headers)
      .set(BROWSER_AUTH_HEADERS.key, '<fake-wrong-key>')
      .send(body)
      .expect(403)
    expect(await context.prisma.mfaFactor.count()).toBe(0)
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
  })
  it('redeems an offline ticket only for new-app setup and publishes no rights before saved-code confirmation', async () => {
    const f = await initial()
    const issuedTicket = await new MfaOfflineRecovery(
      context.prisma,
      context.app.get(MfaSecurityEvents)
    ).issue({
      userId: f.userId,
      reason: 'isolated HTTP lost-app recovery',
      confirmation: `RESET ${f.userId}`,
    })
    const start = await request(context.app.getHttpServer())
      .post('/auth/login')
      .set(f.headers)
      .send({ email, password })
      .expect(202)
    expect(start.body.nextAction).toBe('recovery_ticket')
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(start.body.browser.generation)
    await command('enrollment', start.body.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID() })
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('restart_required'))
    const operationId = randomUUID(),
      input = { purpose: 'initial_setup', operationId, password, ticket: issuedTicket.ticket }
    const rejected = await command('redeem-recovery-ticket', start.body.continuation, f.headers)
      .send({ ...input, operationId: randomUUID(), ticket: mfaCredential() })
      .expect(200)
    expect(rejected.body).toEqual({ outcome: 'wrong_ticket' })
    const redeemed = await command('redeem-recovery-ticket', start.body.continuation, f.headers)
      .send(input)
      .expect(200)
    expect(redeemed.body.outcome).toBe('enrollment')
    expect(redeemed.body).not.toHaveProperty('accessToken')
    expect(redeemed.headers['set-cookie']).toBeUndefined()
    expect(await context.prisma.authSessionFamily.count()).toBe(0)
    await command('redeem-recovery-ticket', start.body.continuation, f.headers)
      .send(input)
      .expect(200)
      .expect(({ body }) => expect(body.outcome).toBe('restart_required'))
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(redeemed.body.successor.browser.generation)
    const draft = await command('enrollment', redeemed.body.successor.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: randomUUID() })
      .expect(200)
    const now = await mfaDatabaseClock(context.prisma),
      code = await generate({
        secret: draft.body.enrollment.secret,
        epoch: Math.floor(now.getTime() / 1000),
      })
    const bound = await command('bind-factor', redeemed.body.successor.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: randomUUID(),
        proof: { method: 'totp', code },
      })
      .expect(200)
    const successor = bound.body.successor
    expect(bound.body.outcome).toBe('bound')
    f.headers[BROWSER_AUTH_HEADERS.generation] = String(successor.browser.generation)
    await command('acknowledge-codes', successor.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: randomUUID(),
        generation: successor.backupCodes.generation,
      })
      .expect(200)
    const completionId = randomUUID(),
      vaultBinding = mfaCredential()
    const credentials = await command('complete', successor.continuation, f.headers)
      .send({ purpose: 'initial_setup', operationId: completionId, vaultBinding })
      .expect(200)
    const me = () =>
      request(context.app.getHttpServer())
        .get('/auth/me')
        .set(f.headers)
        .set('Authorization', `Bearer ${credentials.body.accessToken}`)
    await me().expect(401)
    await command('publication/acknowledge', successor.continuation, f.headers)
      .send({
        purpose: 'initial_setup',
        operationId: completionId,
        vaultBinding,
        accessToken: credentials.body.accessToken,
        receipt: credentials.body.publication.receipt,
      })
      .expect(200)
    await me().expect(200)
    expect(
      await context.prisma.mfaAccount.findUnique({ where: { userId: f.userId } })
    ).toMatchObject({ emergencyRequired: false, setupComplete: true, securityVersion: 2 })
  })
})
