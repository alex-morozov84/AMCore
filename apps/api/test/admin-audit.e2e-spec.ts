import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import type { PrismaService } from '../src/prisma'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'

describe('Admin audit browser (e2e)', () => {
  let context: E2ETestContext
  let app: INestApplication
  let prisma: PrismaService
  let token: string
  let operatorId: string

  beforeAll(async () => {
    process.env.JWT_SECRET = 'audit-e2e-secret-at-least-32-characters'
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'audit-operator@example.com', password: 'StrongP@ss123' })
      .expect(201)
    operatorId = register.body.user.id as string
    await prisma.user.update({ where: { id: operatorId }, data: { systemRole: 'SUPER_ADMIN' } })
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'audit-operator@example.com', password: 'StrongP@ss123' })
      .expect(200)
    token = login.body.accessToken as string
  }, 120_000)

  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120_000)

  const get = (params = '') =>
    request(app.getHttpServer())
      .get(`/admin/audit-logs${params}`)
      .set('Authorization', `Bearer ${token}`)

  it('denies unauthenticated and non-super-admin reads', async () => {
    await request(app.getHttpServer()).get('/admin/audit-logs').expect(401)
    const user = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'audit-user@example.com', password: 'StrongP@ss123' })
      .expect(201)
    await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${user.body.accessToken}`)
      .expect(403)
  })

  it('rejects repeated and unknown filters and unbounded ranges', async () => {
    const statuses = []
    for (const suffix of [
      '?actorId=a&actorId=b',
      '?limit=1&limit=2',
      '?sort=asc',
      '?limit=51',
      '?from=2026-01-01T00%3A00%3A00.000Z&to=2026-03-01T00%3A00%3A00.000Z',
    ]) {
      statuses.push((await get(suffix)).status)
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400])
  })

  it('audits one successful empty read without recording filter values', async () => {
    const action = 'admin.no_matching_audit_events'
    const before = await prisma.auditLog.count({ where: { action: 'admin.audit_logs.viewed' } })
    const response = await get(`?action=${action}`)
    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
    const events = await prisma.auditLog.findMany({
      where: { action: 'admin.audit_logs.viewed' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    expect(await prisma.auditLog.count({ where: { action: 'admin.audit_logs.viewed' } })).toBe(
      before + 1
    )
    expect(events[0]?.metadata).toMatchObject({ action: true, resultCount: 0 })
    expect(JSON.stringify(events[0]?.metadata)).not.toContain(action)
    await get('?actorId=a&actorId=b').expect(400)
    expect(await prisma.auditLog.count({ where: { action: 'admin.audit_logs.viewed' } })).toBe(
      before + 1
    )
  })

  it('includes audit views when they are explicitly selected with other actions', async () => {
    const selected = await get('?actions=admin.audit_logs.viewed,admin.audit_probe.absent').expect(
      200
    )
    expect(selected.body.items).toContainEqual(
      expect.objectContaining({ action: 'admin.audit_logs.viewed' })
    )
  })

  it('hides audit views by default and includes them with the explicit switch', async () => {
    const hidden = await get('?limit=50').expect(200)
    expect(hidden.body.items).not.toContainEqual(
      expect.objectContaining({ action: 'admin.audit_logs.viewed' })
    )
    const visible = await get('?limit=50&includeReadEvents=true').expect(200)
    expect(visible.body.items).toContainEqual(
      expect.objectContaining({ action: 'admin.audit_logs.viewed' })
    )
  })

  it('returns every legacy-ID row exactly once with private bounded cursors', async () => {
    const createdAt = new Date(Date.now() - 60_000)
    const action = 'admin.audit_probe.created'
    const hostile = 'private/' + 'x'.repeat(1_000)
    for (const id of ['a-event', hostile, 'z-event']) {
      await prisma.auditLog.create({
        data: {
          id,
          createdAt,
          actorType: 'USER',
          actorId: operatorId,
          targetType: 'USER',
          targetId: operatorId,
          action,
          category: 'SECURITY',
          metadata: { password: 'secret-value' },
        },
      })
    }
    const from = new Date(createdAt.getTime() - 1000).toISOString()
    const to = new Date().toISOString()
    const params = new URLSearchParams({ action, from, to, limit: '1' })
    const collected: Array<string | null> = []
    for (let page = 0; page < 3; page += 1) {
      const response = await get(`?${params}`)
      if (response.status !== 200) throw new Error(JSON.stringify(response.body))
      expect(response.headers['cache-control']).toContain('no-store')
      expect(response.body.items).toHaveLength(1)
      expect(JSON.stringify(response.body)).not.toContain(hostile)
      expect(JSON.stringify(response.body)).not.toContain('secret-value')
      expect(response.body.items[0].actorIdentity).toMatchObject({
        status: 'current',
        email: 'audit-operator@example.com',
      })
      collected.push(response.body.items[0].id as string | null)
      expect(response.body.hasMore).toBe(page < 2)
      expect((response.body.nextCursor ?? '').length).toBeLessThanOrEqual(512)
      if (response.body.nextCursor) params.set('cursor', response.body.nextCursor as string)
    }
    expect(collected).toEqual(['z-event', null, 'a-event'])
    const views = await prisma.auditLog.count({
      where: { action: 'admin.audit_logs.viewed', actorId: operatorId },
    })
    expect(views).toBeGreaterThanOrEqual(3)
  }, 120_000)

  it('rejects a mismatched cursor instead of serving a false empty page', async () => {
    const first = await get('?limit=1&includeReadEvents=true')
    if (first.status !== 200) throw new Error(JSON.stringify(first.body))
    if (!first.body.nextCursor) throw new Error('Expected multiple audit events')
    expect(first.body.items[0].action).toBe('admin.audit_logs.viewed')
    const params = new URLSearchParams({
      limit: '1',
      from: first.body.from,
      to: first.body.to,
      cursor: first.body.nextCursor,
      action: 'admin.audit_probe.created',
      includeReadEvents: 'true',
    })
    expect((await get(`?${params}`)).status).toBe(400)
  })

  it('rejects a SUPER_ADMIN-owned API key on this bearer-only route', async () => {
    const organization = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Audit Key Organization' })
      .expect(201)
    const key = await request(app.getHttpServer())
      .post('/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Audit key', organizationId: organization.body.id, scopes: ['read:User'] })
      .expect(201)
    await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${key.body.key}`)
      .expect(401)
  })

  it('serves no rows if the strict viewed-event insert fails', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION core.fail_audit_view_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'admin.audit_logs.viewed' THEN RAISE EXCEPTION 'audit unavailable'; END IF;
        RETURN NEW;
      END $$;
    `)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_audit_view_for_test
      BEFORE INSERT ON core.audit_log FOR EACH ROW EXECUTE FUNCTION core.fail_audit_view_for_test()`)
    try {
      const response = await get('?action=admin.audit_probe.created')
      expect(response.status).toBeGreaterThanOrEqual(500)
      expect(response.body).not.toHaveProperty('items')
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_audit_view_for_test ON core.audit_log')
      await prisma.$executeRawUnsafe('DROP FUNCTION core.fail_audit_view_for_test()')
    }
  })

  it('rejects the stale JWT immediately after demotion', async () => {
    await prisma.user.update({ where: { id: operatorId }, data: { systemRole: 'USER' } })
    expect((await get()).status).toBe(403)
  })
})
