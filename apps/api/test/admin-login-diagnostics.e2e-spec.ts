import { randomUUID } from 'node:crypto'

import request from 'supertest'

import { adminUserDetailResponseSchema } from '@amcore/shared'

import type { OAuthProvider } from '../src/generated/prisma/client'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  signAccessToken,
  teardownE2ETest,
} from './helpers'
import { holdLoginSnapshot } from './helpers/login-diagnostics-snapshot'

describe('Admin login diagnostics (HTTP and real database)', () => {
  let context: E2ETestContext
  let actorId: string
  let token: string
  const canary = '<credential-canary>'
  beforeAll(async () => {
    context = await setupE2ETest()
    await seedSystemRoles(context.prisma)
  }, 120000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanOrgData(context.prisma)
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    const actor = await target(null)
    actorId = actor.id
    await context.prisma.user.update({
      where: { id: actorId },
      data: { systemRole: 'SUPER_ADMIN' },
    })
    token = signAccessToken(context.app, {
      sub: actorId,
      email: actor.email,
      systemRole: 'SUPER_ADMIN',
    })
  })
  const http = () => request(context.app.getHttpServer())
  const detail = (id: string, bearer = token) =>
    http().get(`/admin/users/${id}`).set('Authorization', `Bearer ${bearer}`)
  async function target(passwordHash: string | null, id?: string) {
    const email = `${randomUUID()}@diagnostics.example.test`
    return context.prisma.user.create({ data: { id, email, emailCanonical: email, passwordHash } })
  }
  async function link(userId: string, provider: OAuthProvider = 'GOOGLE') {
    return context.prisma.oAuthAccount.create({
      data: {
        userId,
        provider,
        providerAccountId: `${canary}-${randomUUID()}`,
        accessToken: canary,
        refreshToken: canary,
      },
    })
  }

  it('returns exact detail-only setup facts for local, OAuth, mixed and neutral targets', async () => {
    const local = await target(canary)
    const oauth = await target(null, randomUUID())
    await link(oauth.id)
    const mixed = await target(canary)
    for (const provider of [
      'GOOGLE',
      'GOOGLE',
      'GOOGLE',
      'GOOGLE',
      'GOOGLE',
      'GITHUB',
      'APPLE',
      'TELEGRAM',
    ] as const)
      await link(mixed.id, provider)
    const none = await target(null)
    const empty = await target('')
    for (const [user, hasPassword, linkedProviders] of [
      [local, true, []],
      [oauth, false, ['google']],
      [mixed, true, ['google', 'github', 'apple', 'telegram']],
      [none, false, []],
      [empty, false, []],
    ] as const) {
      const response = await detail(user.id).expect(200)
      const parsed = adminUserDetailResponseSchema.parse(response.body)
      expect(parsed.loginDiagnostics.hasPassword).toBe(hasPassword)
      expect([...parsed.loginDiagnostics.linkedProviders].sort()).toEqual(
        [...linkedProviders].sort()
      )
      expect(Object.keys(parsed.loginDiagnostics).sort()).toEqual([
        'hasPassword',
        'linkedProviders',
      ])
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect(response.text).not.toContain(canary)
      expect(response.text).not.toMatch(
        /passwordHash|accessToken|refreshToken|idToken|providerAccountId|emailCanonical/
      )
      expect(parsed.user.lastLoginAt).toBeNull()
    }
    const list = await http()
      .get('/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    for (const row of list.body.data) expect(row).not.toHaveProperty('loginDiagnostics')
    const me = await http().get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200)
    expect(me.body.user).not.toHaveProperty('loginDiagnostics')
  })

  it('rejects anonymous, regular, organization-admin and live-demoted callers', async () => {
    const user = await target(null)
    await http().get(`/admin/users/${user.id}`).expect(401)
    const regular = signAccessToken(context.app, {
      sub: user.id,
      email: user.email,
      systemRole: 'USER',
    })
    await detail(user.id, regular).expect(403)
    await http()
      .post('/organizations')
      .set('Authorization', `Bearer ${regular}`)
      .send({ name: 'Diagnostic organization' })
      .expect(201)
    await detail(user.id, regular).expect(403)
    await context.prisma.user.update({ where: { id: actorId }, data: { systemRole: 'USER' } })
    await detail(user.id).expect(403)
  })

  it('rejects a genuine SUPER_ADMIN-owned API key at this exact endpoint', async () => {
    const org = await http()
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Diagnostic key owner' })
      .expect(201)
    const key = await http()
      .post('/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ organizationId: org.body.id, name: 'Diagnostics probe', scopes: ['read:User'] })
      .expect(201)
    await http().get('/auth/me').set('Authorization', `Bearer ${key.body.key}`).expect(200)
    await detail(actorId, key.body.key).expect(401)
  })

  it('returns 400 for malformed ID and 404 for valid missing identities', async () => {
    await detail('not-an-id').expect(400)
    await detail(randomUUID()).expect(404)
    await detail('clz1234560000abcdefghijk').expect(404)
  })

  it('keeps row and derived facts on one real snapshot while password and links change', async () => {
    const user = await target(canary)
    await link(user.id)
    const held = holdLoginSnapshot(context.prisma, user.id)
    const pending = detail(user.id).then((response) => response)
    try {
      await Promise.race([
        held.ready,
        pending.then(() => {
          throw new Error('Detail finished before its snapshot barrier')
        }),
      ])
      await context.prisma.$transaction([
        context.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: null, name: 'Changed concurrently' },
        }),
        context.prisma.oAuthAccount.deleteMany({ where: { userId: user.id } }),
      ])
      held.release()
      const old = await pending
      expect(old.status).toBe(200)
      expect(old.body.user.name).toBeNull()
      expect(old.body.loginDiagnostics).toEqual({ hasPassword: true, linkedProviders: ['google'] })
    } finally {
      held.restore()
      await pending.catch(() => undefined)
    }
    const fresh = await detail(user.id).expect(200)
    expect(fresh.body.user.name).toBe('Changed concurrently')
    expect(fresh.body.loginDiagnostics).toEqual({ hasPassword: false, linkedProviders: [] })
  })
})
