import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { adminQueuesResponseSchema, SystemRole } from '@amcore/shared'

import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

const ROUTE = '/admin/background-work/queues'
const PASSWORD = 'StrongP@ss123'

describe('Admin background-work queues (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
    // The producer client resolves asynchronously after init; wait until the summary can read Redis.
    await waitForAvailableQueue()
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  async function register(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201)
    return { token: res.body.accessToken as string, userId: res.body.user.id as string }
  }

  async function makeSuperAdmin(email: string) {
    const { userId } = await register(email)
    await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200)
    return { userId, token: res.body.accessToken as string }
  }

  async function waitForAvailableQueue(): Promise<void> {
    const service = app.get((await import('../src/infrastructure/queue')).QueueObservationService)
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = await service.observe()
      if (rows.every((row) => row.status === 'available')) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Queue observation never became available')
  }

  it('rejects anonymous callers', async () => {
    await request(app.getHttpServer()).get(ROUTE).expect(401)
  })

  it('rejects a regular user and an organization admin', async () => {
    const { token } = await register('queues-user@example.com')
    await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)

    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Queues Probe Organization' })
      .expect(201)
    await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
  })

  it('rejects a SUPER_ADMIN-owned API key (bearer-only, OA-02)', async () => {
    const { token, userId } = await makeSuperAdmin('queues-key-admin@example.com')
    const org = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Queues Key Org' })
      .expect(201)
    const key = await request(app.getHttpServer())
      .post('/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Attacker key', organizationId: org.body.id, scopes: ['read:User'] })
      .expect(201)
    expect(userId).toBeDefined()

    await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', `Bearer ${key.body.key as string}`)
      .expect(401)
  })

  it('returns the typed summary for a SUPER_ADMIN without payloads, and never caches it', async () => {
    const { token } = await makeSuperAdmin('queues-admin@example.com')
    const { QueueService, QueueName } = await import('../src/infrastructure/queue')
    const queues = app.get(QueueService)
    // `default` has no processor, so this job stays waiting.
    await queues.add(QueueName.DEFAULT, 'e2e-probe', { secret: 'PAYLOAD-MUST-NOT-LEAK' })

    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(response.headers['cache-control']).toBe('private, no-store')
    const body = adminQueuesResponseSchema.parse(response.body)
    expect(body.queues.map((queue) => queue.name)).toEqual([
      'email',
      'default',
      'notifications',
      'ai-runs',
    ])
    const row = body.queues.find((queue) => queue.name === 'default')
    expect(row).toMatchObject({
      status: 'available',
      kind: 'extension',
      paused: false,
      inBoard: true,
    })
    // The board is mounted in this (non-production) harness; `ai-runs` has no board adapter.
    expect(body.board).toEqual({ state: 'available' })
    expect(body.queues.find((queue) => queue.name === 'ai-runs')?.inBoard).toBe(false)
    expect(body.queues.filter((queue) => queue.inBoard).map((queue) => queue.name)).toEqual([
      'email',
      'default',
      'notifications',
    ])
    const observed = row?.status === 'available' ? row : undefined
    expect(observed?.counts.waiting).toBeGreaterThanOrEqual(1)
    expect(['sample', 'unknown']).toContain(observed?.age.status)
    expect(response.text).not.toContain('PAYLOAD-MUST-NOT-LEAK')
    expect(response.text).not.toContain('e2e-probe')
  })

  it('denies a demoted SUPER_ADMIN on the next request', async () => {
    const a = await makeSuperAdmin('queues-admin-a@example.com')
    const b = await makeSuperAdmin('queues-admin-b@example.com')
    await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200)

    await request(app.getHttpServer())
      .patch(`/admin/users/${b.userId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ systemRole: SystemRole.User })
      .expect(200)

    await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(403)
  })
})
