import { jest } from '@jest/globals'
import { Client } from 'pg'
import request from 'supertest'
import { z } from 'zod'

import { type RequestPrincipal, storageProbeSettingResponseSchema } from '@amcore/shared'

import { AuditLogService } from '../src/core/audit'
import { Prisma } from '../src/generated/prisma/client'
import type { SettingDefinition } from '../src/infrastructure/settings/setting-definition'
import { testDefinition } from '../src/infrastructure/settings/setting-definition.fixture'
import { SettingRegistry } from '../src/infrastructure/settings/setting-registry'
import { SettingRepository } from '../src/infrastructure/settings/setting-repository'
import { SettingWriter } from '../src/infrastructure/settings/setting-writer'
import { SettingsReader } from '../src/infrastructure/settings/settings-reader'
import { StorageSettingDefinition } from '../src/infrastructure/settings/storage-setting.definition'
import { StorageProbeIo } from '../src/infrastructure/storage/storage-probe.io'

import {
  type E2ETestContext,
  noopPinoLogger,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('runtime settings persistence and admission', () => {
  let c: E2ETestContext
  let token: string
  let auditCount: number
  let userId: string
  const key = 'storage.probe.intervalSeconds'
  const route = '/admin/runtime-settings/storage-probe'
  beforeAll(async () => {
    c = await setupE2ETest()
    await seedSystemRoles(c.prisma)
    const registered = await request(c.app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'settings@example.test', password: 'StrongP@ss123' })
      .expect(201)
    userId = registered.body.user.id
    await c.prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
    const login = await request(c.app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'settings@example.test', password: 'StrongP@ss123' })
      .expect(200)
    token = login.body.accessToken
  }, 120_000)
  afterAll(async () => {
    if (c) await teardownE2ETest(c)
  }, 120_000)
  beforeEach(async () => {
    await c.throttlerStorage.reset()
    await c.prisma.platformSetting.update({
      where: { key },
      data: { revision: 0, override: Prisma.DbNull },
    })
    auditCount = await c.prisma.auditLog.count({
      where: { action: 'admin.runtime_setting.changed' },
    })
  })
  const get = () => request(c.app.getHttpServer()).get(route).auth(token, { type: 'bearer' })
  const patch = (intervalSeconds: number | null, expectedRevision: number) =>
    request(c.app.getHttpServer())
      .patch(route)
      .auth(token, { type: 'bearer' })
      .send({ intervalSeconds, expectedRevision })

  it('seeds baseline, persists an explicit baseline override, resets with revision and rejects ABA', async () => {
    const read = await get().expect(200)
    expect(storageProbeSettingResponseSchema.parse(read.body).saved).toEqual({
      intervalSeconds: null,
      revision: 0,
    })
    expect(read.headers['cache-control']).toContain('no-store')
    expect((await patch(600, 0).expect(200)).body.saved).toEqual({
      intervalSeconds: 600,
      revision: 1,
    })
    await patch(600, 1).expect(200)
    expect(
      await c.prisma.auditLog.count({ where: { action: 'admin.runtime_setting.changed' } })
    ).toBe(auditCount + 1)
    expect((await patch(null, 1).expect(200)).body.saved).toEqual({
      intervalSeconds: null,
      revision: 2,
    })
    await patch(60, 0).expect(409)
    const rows = await c.prisma.auditLog.findMany({
      where: { action: 'admin.runtime_setting.changed' },
      orderBy: { createdAt: 'asc' },
      skip: auditCount,
    })
    expect(rows[1]).toMatchObject({
      targetId: 'storage_probe',
      targetType: 'RUNTIME_SETTING',
      organizationId: null,
      metadata: {
        settingKey: key,
        beforeRevision: 1,
        afterRevision: 2,
        beforeIntervalSeconds: 600,
        afterIntervalSeconds: null,
      },
    })
  })

  it('serializes same-revision races, including a stale no-op', async () => {
    const results = await Promise.all([patch(60, 0), patch(120, 0)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const row = await c.prisma.platformSetting.findUniqueOrThrow({ where: { key } })
    await patch((row.override as { value: number }).value, 0).expect(409)
    expect(
      await c.prisma.auditLog.count({ where: { action: 'admin.runtime_setting.changed' } })
    ).toBe(auditCount + 1)
  })

  it('rolls back the setting if transactional audit fails', async () => {
    const audit = c.app.get(AuditLogService)
    const failure = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('audit unavailable'))
    try {
      await patch(60, 0).expect(500)
    } finally {
      failure.mockRestore()
    }
    expect((await get().expect(200)).body.saved).toEqual({ intervalSeconds: null, revision: 0 })
    expect(
      await c.prisma.auditLog.count({ where: { action: 'admin.runtime_setting.changed' } })
    ).toBe(auditCount)
  })

  it('reuses the writer/reader for string, boolean and explicit null without a production definition', async () => {
    const definitions: SettingDefinition<unknown>[] = [
      testDefinition('test.string', z.string(), 'base'),
      testDefinition('test.boolean', z.boolean(), false),
      testDefinition('test.nullable', z.string().nullable(), 'base'),
    ]
    const registry = new SettingRegistry(definitions)
    const writer = new SettingWriter(registry, c.prisma, c.app.get(AuditLogService))
    const reader = new SettingsReader(registry, new SettingRepository(c.prisma), noopPinoLogger)
    try {
      for (const d of definitions) await c.prisma.platformSetting.create({ data: { key: d.key } })
      const actor = { sub: userId } as RequestPrincipal
      await writer.write(definitions[0]!, 'example', 0, actor)
      await writer.write(definitions[1]!, true, 0, actor)
      await writer.write(definitions[2]!, null, 0, actor)
      await reader.refresh()
      expect(definitions.map((d) => reader.snapshot(d).value)).toEqual(['example', true, null])
      await writer.write(definitions[2]!, undefined, 1, actor)
      await reader.refresh()
      expect(reader.snapshot(definitions[2]!).value).toBe('base')
      expect(
        await c.prisma
          .$queryRaw`SELECT override IS NULL AS cleared FROM core.platform_settings WHERE key = 'test.nullable'`
      ).toEqual([{ cleared: true }])
    } finally {
      reader.onModuleDestroy()
      await c.prisma.platformSetting.deleteMany({
        where: { key: { in: definitions.map((d) => d.key) } },
      })
    }
  })

  it('does not start storage I/O on settings reads or writes, and preserves unknown rows', async () => {
    const io = c.app.get(StorageProbeIo)
    const write = jest.spyOn(io, 'write')
    await c.prisma.platformSetting.create({
      data: { key: 'future.unknown', override: { value: 'preserved' }, schemaVersion: 2 },
    })
    try {
      await get().expect(200)
      await patch(3600, 0).expect(200)
      expect(write).not.toHaveBeenCalled()
      expect(
        (await c.prisma.platformSetting.findUniqueOrThrow({ where: { key: 'future.unknown' } }))
          .schemaVersion
      ).toBe(2)
    } finally {
      write.mockRestore()
      await c.prisma.platformSetting.delete({ where: { key: 'future.unknown' } })
    }
  })

  it('fails missing authoritative data without creating a row and keeps observations available', async () => {
    await c.prisma.platformSetting.delete({ where: { key } })
    try {
      await get().expect(503)
      await request(c.app.getHttpServer())
        .get('/admin/overview')
        .auth(token, { type: 'bearer' })
        .expect(200)
      expect(await c.prisma.platformSetting.count({ where: { key } })).toBe(0)
    } finally {
      await c.prisma.platformSetting.create({ data: { key } })
    }
  })

  it('bounds a real blocked SELECT, retains LKG and recovers after the lock clears', async () => {
    const repository = new SettingRepository(c.prisma)
    const d = c.app.get(StorageSettingDefinition)
    const reader = new SettingsReader(new SettingRegistry([d]), repository, noopPinoLogger)
    await reader.refresh()
    const client = new Client({ connectionString: c.postgresContainer.getConnectionUri() })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('LOCK TABLE core.platform_settings IN ACCESS EXCLUSIVE MODE')
      const start = performance.now()
      await reader.refresh()
      expect(performance.now() - start).toBeLessThan(5000)
      expect(reader.snapshot(d)).toMatchObject({ revision: 0, refreshStatus: 'failed' })
      await client.query('ROLLBACK')
      await reader.refresh()
      expect(reader.snapshot(d).refreshStatus).toBe('confirmed')
    } finally {
      await client.query('ROLLBACK')
      await client.end()
      reader.onModuleDestroy()
    }
  })

  it('requires personal current platform role and fresh session; rejects invalid shapes', async () => {
    await request(c.app.getHttpServer()).get(route).expect(401)
    await request(c.app.getHttpServer())
      .patch(route)
      .auth(token, { type: 'bearer' })
      .send({ intervalSeconds: 29, expectedRevision: 0 })
      .expect(400)
    await request(c.app.getHttpServer())
      .patch(route)
      .auth(token, { type: 'bearer' })
      .send({ intervalSeconds: 60, expectedRevision: 0, unexpected: true })
      .expect(400)
    await c.prisma.session.updateMany({
      where: { userId },
      data: { lastAuthAt: new Date(Date.now() - 3600_000) },
    })
    try {
      await get().expect(200)
      expect((await patch(60, 0).expect(403)).body.errorCode).toBe('STEP_UP_REQUIRED')
    } finally {
      await c.prisma.session.updateMany({ where: { userId }, data: { lastAuthAt: new Date() } })
    }
    await c.prisma.user.update({ where: { id: userId }, data: { systemRole: 'USER' } })
    try {
      await get().expect(403)
      await patch(60, 0).expect(403)
    } finally {
      await c.prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
    }
  })

  it('bounds real pool saturation without launching another underlying refresh', async () => {
    const repository = new SettingRepository(c.prisma)
    const d = c.app.get(StorageSettingDefinition)
    const reader = new SettingsReader(new SettingRegistry([d]), repository, noopPinoLogger)
    await reader.refresh()
    const refresh = jest.spyOn(repository, 'refresh')
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = 0
    const holders = Array.from({ length: 10 }, () =>
      c.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`
          entered++
          await held
        },
        { maxWait: 5000, timeout: 10_000 }
      )
    )
    try {
      const start = performance.now()
      while (entered < 10) {
        if (performance.now() - start > 5000)
          throw new Error('Pool fixture did not acquire all leases')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const refreshStart = performance.now()
      const first = reader.refresh()
      const second = reader.refresh()
      await Promise.all([first, second])
      expect(performance.now() - refreshStart).toBeLessThan(5000)
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(reader.snapshot(d)).toMatchObject({ revision: 0, refreshStatus: 'failed' })
    } finally {
      release()
      await Promise.all(holders)
    }
    await reader.refresh()
    expect(reader.snapshot(d).refreshStatus).toBe('confirmed')
    reader.onModuleDestroy()
  })

  it('denies organization admin and SUPER_ADMIN-owned API key on platform settings', async () => {
    const org = await request(c.app.getHttpServer())
      .post('/organizations')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Settings authorization test' })
      .expect(201)
    const apiKey = await request(c.app.getHttpServer())
      .post('/api-keys')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Settings denied key', organizationId: org.body.id, scopes: ['read:User'] })
      .expect(201)
    const exchanged = await request(c.app.getHttpServer())
      .post(`/organizations/${org.body.id}/switch`)
      .auth(token, { type: 'bearer' })
      .expect(200)
    await request(c.app.getHttpServer())
      .get(route)
      .auth(exchanged.body.accessToken, { type: 'bearer' })
      .expect(403)
    await request(c.app.getHttpServer())
      .patch(route)
      .auth(exchanged.body.accessToken, { type: 'bearer' })
      .send({ intervalSeconds: 60, expectedRevision: 0 })
      .expect(403)
    await get().set('X-AMCore-Organization-ID', org.body.id).expect(400)
    await request(c.app.getHttpServer())
      .get(route)
      .auth(apiKey.body.key, { type: 'bearer' })
      .expect(401)
    await request(c.app.getHttpServer())
      .patch(route)
      .auth(apiKey.body.key, { type: 'bearer' })
      .send({ intervalSeconds: 60, expectedRevision: 0 })
      .expect(401)
    await c.prisma.user.update({ where: { id: userId }, data: { systemRole: 'USER' } })
    try {
      await get().expect(403)
      await patch(60, 0).expect(403)
    } finally {
      await c.prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
    }
  })

  it('rate limits privileged writes without turning no-ops into audit changes', async () => {
    const statuses = []
    for (let i = 0; i < 21; i++) statuses.push((await patch(null, 0)).status)
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(200))
    expect(statuses[20]).toBe(429)
    expect(
      await c.prisma.auditLog.count({ where: { action: 'admin.runtime_setting.changed' } })
    ).toBe(auditCount)
  })
})
