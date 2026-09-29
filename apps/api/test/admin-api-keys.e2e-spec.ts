import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { adminApiKeyQuerySchema } from '@amcore/shared'

import { AdminApiKeysService } from '../src/core/admin/admin-api-keys.service'
import { staleTerminalApiKeyWhere } from '../src/core/api-keys/api-key-lifecycle'
import { ApiKeyRevocationService } from '../src/core/api-keys/api-key-revocation.service'
import { ApiKeysService } from '../src/core/api-keys/api-keys.service'
import { AuditLogService } from '../src/core/audit'
import type { PrismaService } from '../src/prisma'

import { explainInventoryQueries, proveInventorySnapshot } from './api-key-query-proofs'
import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

const jestApi = (import.meta as ImportMeta & { jest: typeof jest }).jest

/** Real DB/HTTP proof: lifecycle, transactional audit and platform boundaries. */
describe('Platform API keys (e2e)', () => {
  let context: E2ETestContext, app: INestApplication, prisma: PrismaService
  const password = 'StrongP@ss123'
  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
  }, 120000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })
  afterEach(() => jestApi.restoreAllMocks())
  async function user(email = 'owner@example.test', admin = false) {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    const id = registered.body.user.id as string
    if (admin) await prisma.user.update({ where: { id }, data: { systemRole: 'SUPER_ADMIN' } })
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200)
    return { id, token: login.body.accessToken as string }
  }
  async function fixture() {
    const owner = await user()
    const admin = await user('admin@example.test', true)
    const org = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Org', slug: 'key-org' })
      .expect(201)
    const create = async (name = 'Integration') =>
      (
        await request(app.getHttpServer())
          .post('/api-keys')
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ organizationId: org.body.id, name, scopes: ['read:User'] })
          .expect(201)
      ).body as { id: string; key: string }
    const key = await create()
    return { owner, admin, organizationId: org.body.id as string, key, create }
  }
  const get = (token: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get('/admin/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .query(query)
  const bulk = (token: string, ids: string[]) =>
    request(app.getHttpServer())
      .post('/admin/api-keys/revoke')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids })

  it('projects safe metadata, literal search and captured lifecycle with private/no-store and strict read audit', async () => {
    const f = await fixture()
    await f.create('100%_match')
    await f.create('100ZZmatch')
    const result = await get(f.admin.token, { search: '%_', userId: f.owner.id }).expect(200)
    expect(result.headers['cache-control']).toBe('private, no-store')
    expect(result.body.total).toBe(1)
    expect(result.body.data[0].name).toBe('100%_match')
    for (const field of ['key', 'keyHash', 'salt', 'shortToken'])
      expect(result.body.data[0]).not.toHaveProperty(field)
    expect(result.body.data[0]).toMatchObject({
      status: 'unexpired',
      owner: { id: f.owner.id },
      organization: { id: f.organizationId },
    })
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.api_keys.viewed' },
    })
    expect(audit.metadata).toEqual({
      search: true,
      user: true,
      organization: false,
      id: false,
      status: false,
      resultCount: 1,
    })
    jestApi
      .spyOn(app.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('audit unavailable'))
    const failed = await get(f.admin.token)
    expect(failed.status).toBeGreaterThanOrEqual(500)
    expect(failed.body).not.toHaveProperty('data')
  })
  it('destroys verifier, preserves first actor/time/reason and counts no-op requests separately', async () => {
    const f = await fixture()
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${f.key.key}`)
      .expect(200)
    const first = await bulk(f.admin.token, [f.key.id]).expect(200)
    expect(first.body).toEqual({ requestedCount: 1, affectedCount: 1 })
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: f.key.id } })
    expect(row).toMatchObject({
      keyHash: null,
      salt: null,
      revokedByUserId: f.admin.id,
      revocationReason: 'platform_revoked',
    })
    await request(app.getHttpServer())
      .delete(`/api-keys/${f.key.id}`)
      .set('Authorization', `Bearer ${f.owner.token}`)
      .expect(204)
    expect((await bulk(f.admin.token, [f.key.id]).expect(200)).body).toEqual({
      requestedCount: 1,
      affectedCount: 0,
    })
    expect(await prisma.apiKey.findUniqueOrThrow({ where: { id: f.key.id } })).toMatchObject({
      revokedAt: row.revokedAt,
      revokedByUserId: f.admin.id,
    })
    expect(
      await prisma.auditLog.count({ where: { action: 'api_key.revoked', targetId: f.key.id } })
    ).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.api_keys.revocation_requested', actorId: f.admin.id },
      })
    ).toBe(2)
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${f.key.key}`)
      .expect(401)
    const own = await request(app.getHttpServer())
      .get('/api-keys')
      .set('Authorization', `Bearer ${f.owner.token}`)
      .query({ status: 'revoked' })
      .expect(200)
    expect(own.body.data[0]).toMatchObject({
      id: f.key.id,
      status: 'revoked',
      revokedAt: row.revokedAt?.toISOString(),
    })
  })
  it('rolls back unknown batches and failed transition or request-summary audit', async () => {
    const f = await fixture()
    const second = await f.create('Second')
    await bulk(f.admin.token, [f.key.id, 'cm123456789012345678901234']).expect(404)
    expect(await prisma.apiKey.count({ where: { revokedAt: { not: null } } })).toBe(0)
    const audit = app.get(AuditLogService),
      original = audit.record.bind(audit)
    for (const failAction of ['api_key.revoked', 'admin.api_keys.revocation_requested']) {
      const spy = jestApi.spyOn(audit, 'record').mockImplementation(async (entry, options) => {
        if (entry.action === failAction) throw new Error('forced audit rollback')
        return original(entry, options)
      })
      await expect(
        app.get(ApiKeyRevocationService).revoke([f.key.id, second.id], f.admin.id, true)
      ).rejects.toThrow('forced audit rollback')
      spy.mockRestore()
      expect(await prisma.apiKey.count({ where: { revokedAt: { not: null } } })).toBe(0)
      expect(
        await prisma.auditLog.count({
          where: { action: 'api_key.revoked', organizationId: f.organizationId },
        })
      ).toBe(0)
    }
    await bulk(f.admin.token, [f.key.id, f.key.id]).expect(400)
  })
  it('serializes overlapping own/single/bulk revocations with exactly one transition per key', async () => {
    const f = await fixture()
    const second = await f.create('Second')
    const service = app.get(ApiKeyRevocationService)
    const results = await Promise.all([
      service.revoke([f.key.id], f.owner.id, false),
      service.revoke([f.key.id], f.admin.id, true),
      service.revoke([second.id, f.key.id], f.admin.id, true),
    ])
    expect(results.reduce((n, r) => n + r.affectedCount, 0)).toBe(2)
    expect(
      await prisma.auditLog.count({
        where: { action: 'api_key.revoked', organizationId: f.organizationId },
      })
    ).toBe(2)
    const before = await prisma.apiKey.findUniqueOrThrow({ where: { id: f.key.id } })
    await app.get(ApiKeysService).touchLastUsed(f.key.id)
    await new Promise((resolve) => setImmediate(resolve))
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: f.key.id } })).lastUsedAt).toEqual(
      before.lastUsedAt
    )
  })
  it('denies API-key/ordinary/stale/demoted operator credentials without modifying keys', async () => {
    const f = await fixture()
    await get(f.key.key).expect(401)
    await get(f.owner.token).expect(403)
    await prisma.session.updateMany({
      where: { userId: f.admin.id },
      data: { lastAuthAt: new Date(Date.now() - 3600000) },
    })
    await bulk(f.admin.token, [f.key.id]).expect(403)
    await prisma.user.update({ where: { id: f.admin.id }, data: { systemRole: 'USER' } })
    await get(f.admin.token).expect(403)
    expect(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: f.key.id } })).revokedAt
    ).toBeNull()
  })
  it('retains membership-removed keys and restores access after rejoin, but never after revoke', async () => {
    const f = await fixture()
    const member = await prisma.orgMember.findUniqueOrThrow({
      where: { userId_organizationId: { userId: f.owner.id, organizationId: f.organizationId } },
    })
    await prisma.orgMember.delete({ where: { id: member.id } })
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${f.key.key}`)
      .expect(401)
    expect(await prisma.apiKey.count({ where: { id: f.key.id } })).toBe(1)
    await prisma.orgMember.create({
      data: { userId: f.owner.id, organizationId: f.organizationId },
    })
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${f.key.key}`)
      .expect(200)
    await app.get(ApiKeyRevocationService).revoke([f.key.id], f.owner.id, false)
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${f.key.key}`)
      .expect(401)
  })
  it('enforces complete DB verifier state including NULL/UNKNOWN cases', async () => {
    const f = await fixture()
    for (const data of [
      { keyHash: null },
      { salt: null },
      { revokedAt: new Date() },
      { revokedByUserId: 'actor' },
      { revocationReason: 'platform_revoked' },
    ])
      await expect(prisma.apiKey.update({ where: { id: f.key.id }, data })).rejects.toThrow()
    await app.get(ApiKeyRevocationService).revoke([f.key.id], f.admin.id, true)
    for (const data of [
      { revokedByUserId: null },
      { revocationReason: null },
      { revocationReason: 'invalid' },
      { keyHash: 'verifier' },
      { revokedAt: null },
    ])
      await expect(prisma.apiKey.update({ where: { id: f.key.id }, data })).rejects.toThrow()
  })
  it('purges from first terminal timestamp and preserves recent/nonterminal rows, with parent Cascade', async () => {
    const f = await fixture(),
      now = new Date(),
      cutoff = new Date(now.getTime() - 30 * 86400000)
    const recent = await f.create('Recent'),
      future = await f.create('Future'),
      late = await f.create('Late revoke')
    await prisma.apiKey.update({ where: { id: f.key.id }, data: { expiresAt: cutoff } })
    await prisma.apiKey.update({
      where: { id: late.id },
      data: { expiresAt: new Date(cutoff.getTime() - 1) },
    })
    await app.get(ApiKeyRevocationService).revoke([late.id], f.admin.id, true)
    await prisma.apiKey.update({
      where: { id: recent.id },
      data: { expiresAt: new Date(cutoff.getTime() + 1) },
    })
    await prisma.apiKey.update({
      where: { id: future.id },
      data: { expiresAt: new Date(now.getTime() + 86400000) },
    })
    expect((await prisma.apiKey.deleteMany({ where: staleTerminalApiKeyWhere(now) })).count).toBe(2)
    expect(await prisma.apiKey.count()).toBe(2)
    await prisma.organization.delete({ where: { id: f.organizationId } })
    expect(await prisma.apiKey.count()).toBe(0)
  })
  it('supports UUID owner/org filters and CUID key IDs without verifier exposure', async () => {
    const f = await fixture(),
      userId = randomUUID(),
      organizationId = randomUUID()
    await prisma.user.create({
      data: { id: userId, email: 'uuid@example.test', emailCanonical: 'uuid@example.test' },
    })
    await prisma.organization.create({
      data: { id: organizationId, name: 'UUID Org', slug: 'uuid-org' },
    })
    const key = await prisma.apiKey.create({
      data: {
        name: 'UUID key',
        userId,
        organizationId,
        shortToken: 'uuid-fixture',
        keyHash: 'fake-verifier',
        salt: 'fake-salt',
        scopes: ['read:User'],
      },
    })
    const res = await get(f.admin.token, { userId, organizationId, id: key.id }).expect(200)
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].owner.id).toBe(userId)
    await get(f.admin.token, { userId: 'not-an-id' }).expect(400)
  })
  it('keeps requested selection separate from concurrently issued replacement', async () => {
    const f = await fixture()
    const [result, replacement] = await Promise.all([
      app.get(ApiKeyRevocationService).revoke([f.key.id], f.admin.id, true),
      f.create('Replacement'),
    ])
    expect(result.affectedCount).toBe(1)
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${replacement.key}`)
      .expect(200)
  })
  it('accepts supplied READ COMMITTED transactions but refuses incompatible isolation', async () => {
    const f = await fixture(),
      service = app.get(ApiKeyRevocationService)
    await expect(
      prisma.$transaction((tx) => service.revoke([f.key.id], f.admin.id, true, tx), {
        isolationLevel: 'RepeatableRead',
      })
    ).rejects.toThrow('READ COMMITTED')
    expect(
      (
        await prisma.$transaction((tx) => service.revoke([f.key.id], f.admin.id, true, tx), {
          isolationLevel: 'ReadCommitted',
        })
      ).affectedCount
    ).toBe(1)
  })
  it('returns429/Retry-After without revocation or summary on limiter denial', async () => {
    const f = await fixture()
    for (let n = 0; n < 5; n++) await bulk(f.admin.token, [f.key.id]).expect(200)
    const next = await f.create('Unchanged on denial')
    const denied = await bulk(f.admin.token, [next.id]).expect(429)
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: next.id } })).revokedAt).toBeNull()
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.api_keys.revocation_requested', actorId: f.admin.id },
      })
    ).toBe(5)
  })
  it('uses stable nullable sorting and a coherent REPEATABLE READ inventory contract', async () => {
    const f = await fixture()
    const second = await f.create('Second')
    await prisma.apiKey.update({
      where: { id: second.id },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    })
    for (const sortOrder of ['asc', 'desc']) {
      const res = await app
        .get(AdminApiKeysService)
        .list(adminApiKeyQuerySchema.parse({ sortBy: 'expiresAt', sortOrder }), f.admin.id)
      expect(res.data.map((row) => row.id)).toEqual([second.id, f.key.id])
      expect(res.total).toBe(res.data.length)
    }
  })
  it('keeps page and count coherent across a committed insertion between its actual statements', async () => {
    const f = await fixture()
    const snapshot = await proveInventorySnapshot(
      prisma,
      app.get(AuditLogService),
      context.postgresContainer.getConnectionUri(),
      f.owner.id,
      f.organizationId,
      f.admin.id
    )
    expect(snapshot.total).toBe(1)
    expect(snapshot.data).toHaveLength(1)
  })
  it('records representative inventory EXPLAIN evidence on ten thousand rows', async () => {
    const f = await fixture()
    const evidence = await explainInventoryQueries(prisma, f.owner.id, f.organizationId)
    expect(Object.keys(evidence)).toHaveLength(4)
    if (process.env.API_KEY_QUERY_EVIDENCE_PATH)
      await writeFile(
        process.env.API_KEY_QUERY_EVIDENCE_PATH,
        JSON.stringify(evidence, null, 2) + '\n'
      )
  })
})
