import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { adminQueuesResponseSchema } from '@amcore/shared'

import type { PrismaService } from '../src/prisma'

import { superAdminCookie } from './bull-board.helper'
import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'

/**
 * A production process WITHOUT `ENABLE_BULL_BOARD` in its real environment, booted for real: the
 * application is initialised and listens with the `api/v1` prefix and the isolated Postgres/Redis of
 * this suite. A flag that appears only later (a `.env` loaded after the modules, set here AFTER the
 * import) must not mount anything or be reported as available. This file is its own module cache,
 * so the import-time decision is not shared with any other suite.
 */
const PASSWORD = 'StrongP@ss123'

describe('queue board — booted production process without the flag', () => {
  let context: E2ETestContext
  let app: INestApplication
  let prisma: PrismaService
  let cookie: string
  let accessToken: string

  beforeAll(async () => {
    context = await setupE2ETest(undefined, {
      productionOrder: true,
      productionAtImport: { lateEnableBullBoard: 'true' },
    })
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
    cookie = await superAdminCookie(app, prisma, 'disabled-admin@example.com', '/api/v1')
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'disabled-admin@example.com', password: PASSWORD })
      .expect(200)
    accessToken = login.body.accessToken as string
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  it('has the flag in the environment now, and a frozen decision that says it was not there', async () => {
    expect(process.env.ENABLE_BULL_BOARD).toBe('true')
    const { BULL_BOARD_MOUNT } =
      await import('../src/infrastructure/queue/dashboard/bull-board-mount-state')
    expect(BULL_BOARD_MOUNT).toEqual({ mounted: false, reason: 'disabled_in_production' })
  })

  it('serves nothing at the board path, with a valid Console cookie or bearer', async () => {
    for (const path of [
      '/api/v1/admin/queues',
      '/api/v1/admin/queues/',
      '/api/v1/admin/queues/api/queues',
    ]) {
      const withCookie = await request(app.getHttpServer()).get(path).set('Cookie', cookie)
      expect(withCookie.status).toBe(404)
      const withBearer = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${accessToken}`)
      expect(withBearer.status).toBe(404)
      expect(withCookie.text).not.toContain('bull-board')
    }
  })

  it('reports the confirmed cause to the Console summary through the real route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/background-work/queues')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
    const summary = adminQueuesResponseSchema.parse(res.body)
    expect(summary.board).toEqual({ state: 'disabled' })
    expect(summary.queues.map((queue) => queue.name)).toEqual(
      expect.arrayContaining(['email', 'default', 'notifications', 'ai-runs'])
    )
  })

  it('documents no board operation in the real OpenAPI document', async () => {
    const { buildApiDocument } = await import('../src/swagger.config')
    const nest = app as unknown as Parameters<typeof buildApiDocument>[0]
    const document = buildApiDocument(nest, 'api/v1')
    expect(Object.keys(document.paths).filter((path) => path.includes('/admin/queues'))).toEqual([])
    expect(Object.keys(document.paths)).toContain('/api/v1/admin/background-work/queues')
  })
})
