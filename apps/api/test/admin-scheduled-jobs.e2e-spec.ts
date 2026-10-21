import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { scheduledJobsResponseSchema, scheduledRunsResponseSchema } from '@amcore/shared'

import { SCHEDULED_JOBS } from '../src/infrastructure/schedule/scheduled-jobs.catalogue'
import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

const LIST = '/admin/background-work/scheduled-jobs'
const PASSWORD = 'StrongP@ss123'

describe('Admin scheduled jobs (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await prisma.scheduledJobRun.deleteMany()
    await prisma.scheduledJobSummary.deleteMany()
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

  describe('authorization', () => {
    it('rejects anonymous callers and a regular user on both routes', async () => {
      await request(app.getHttpServer()).get(LIST).expect(401)
      await request(app.getHttpServer()).get(`${LIST}/cleanup/runs`).expect(401)
      const { token } = await register('sj-user@example.com')
      await request(app.getHttpServer())
        .get(LIST)
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
      await request(app.getHttpServer())
        .get(`${LIST}/cleanup/runs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
    })

    it('rejects a SUPER_ADMIN-owned API key (bearer-only, OA-02)', async () => {
      const { token } = await makeSuperAdmin('sj-key-admin@example.com')
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Scheduled Jobs Key Org' })
        .expect(201)
      const key = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Attacker key', organizationId: org.body.id, scopes: ['read:User'] })
        .expect(201)
      await request(app.getHttpServer())
        .get(LIST)
        .set('Authorization', `Bearer ${key.body.key as string}`)
        .expect(401)
    })
  })

  describe('list', () => {
    it('lists every catalogue job as not_reported when no worker registered, never as missing', async () => {
      const { token } = await makeSuperAdmin('sj-empty@example.com')
      const res = await request(app.getHttpServer())
        .get(LIST)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(res.headers['cache-control']).toBe('private, no-store')
      const body = scheduledJobsResponseSchema.parse(res.body)
      expect(body.jobs.map((job) => job.id)).toEqual(SCHEDULED_JOBS.map((job) => job.id))
      expect(body.jobs.every((job) => job.config.state === 'not_reported')).toBe(true)
      expect(body.jobs.every((job) => job.freshness.state === 'unknown')).toBe(true)
    })

    it('reads recorded evidence: partial plus overdue, an unfinished run, a disabled job, a fresh success', async () => {
      const { token } = await makeSuperAdmin('sj-data@example.com')
      const now = new Date()
      const hours = (n: number) => new Date(now.getTime() + n * 3_600_000)
      const base = (jobId: string, extra: Record<string, unknown> = {}) => ({
        jobId,
        firstRegisteredAt: hours(-100),
        lastRegisteredAt: hours(-1),
        configVersion: 'v1',
        scheduleTimeZone: 'UTC',
        enabled: true,
        recordedAt: now,
        baselineDueAt: hours(5),
        ...extra,
      })
      const snapshot = (prefix: string, startedAt: Date, extra: Record<string, unknown> = {}) => ({
        [`${prefix}StartedAt`]: startedAt,
        [`${prefix}RunId`]: randomUUID(),
        [`${prefix}FinishedAt`]: new Date(startedAt.getTime() + 4000),
        [`${prefix}DurationMs`]: 4000,
        ...extra,
      })
      await prisma.scheduledJobSummary.createMany({
        data: [
          base('cleanup', {
            ...snapshot('success', hours(-50), {
              successDueAt: hours(-26),
              successConfigVersion: 'v1',
            }),
            ...snapshot('partial', hours(-2), {
              partialCode: 'bucket_failed',
              partialSummary: { counts: { expiredSessions: 0 }, codes: ['expiredSessions'] },
            }),
          }),
          base('invitation-retention'),
          base('geoip-update', { enabled: false, disabledReason: 'geoip_disabled' }),
          base('notification-retention', {
            ...snapshot('success', hours(-1), {
              successDueAt: hours(23),
              successConfigVersion: 'v1',
            }),
          }),
        ] as never,
      })
      await prisma.scheduledJobRun.create({
        data: { runId: randomUUID(), jobId: 'invitation-retention', startedAt: hours(-3) },
      })

      const res = await request(app.getHttpServer())
        .get(LIST)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      const jobs = Object.fromEntries(
        scheduledJobsResponseSchema.parse(res.body).jobs.map((job) => [job.id, job])
      )
      expect(jobs['cleanup']?.result).toMatchObject({ state: 'partial', code: 'bucket_failed' })
      expect(jobs['cleanup']?.freshness.state).toBe('stale')
      expect(jobs['invitation-retention']?.result.state).toBe('unknown')
      expect(jobs['geoip-update']?.config).toMatchObject({
        state: 'disabled',
        reason: 'geoip_disabled',
      })
      expect(jobs['notification-retention']?.freshness.state).toBe('fresh')
      expect(jobs['ai-run-recovery']?.config.state).toBe('not_reported')
    })

    it('never returns an error message, a row id of another table or any free text', async () => {
      const { token } = await makeSuperAdmin('sj-safe@example.com')
      await prisma.scheduledJobSummary.create({
        data: {
          jobId: 'cleanup',
          firstRegisteredAt: new Date(),
          lastRegisteredAt: new Date(),
          configVersion: 'v1',
          enabled: true,
          recordedAt: new Date(),
          failureStartedAt: new Date(),
          failureRunId: randomUUID(),
          failureFinishedAt: new Date(),
          failureDurationMs: 1,
          failureCode: 'all_buckets_failed',
          failureSummary: { counts: { expiredSessions: 0 }, codes: ['expiredSessions'] },
        },
      })
      const res = await request(app.getHttpServer())
        .get(LIST)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(Object.keys(res.body).sort()).toEqual(['checkedAt', 'jobs'])
      expect(JSON.stringify(res.body)).not.toMatch(/password|token|secret|stack/i)
    })
  })

  describe('history', () => {
    it('returns the newest runs first, at most 20, and says when older ones exist', async () => {
      const { token } = await makeSuperAdmin('sj-runs@example.com')
      const now = Date.now()
      await prisma.scheduledJobRun.createMany({
        data: Array.from({ length: 22 }, (_, index) => ({
          runId: randomUUID(),
          jobId: 'cleanup',
          startedAt: new Date(now - index * 3_600_000),
          finishedAt: new Date(now - index * 3_600_000 + 4000),
          outcome: 'success',
          durationMs: 4000,
        })),
      })
      const res = await request(app.getHttpServer())
        .get(`${LIST}/cleanup/runs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      const body = scheduledRunsResponseSchema.parse(res.body)
      expect(body.runs).toHaveLength(20)
      expect(body.truncated).toBe(true)
      const starts = body.runs.map((run) => run.startedAt)
      expect(starts).toEqual([...starts].sort().reverse())
    })

    it('answers 404 for a frequent or unknown job and 400 for a malformed id', async () => {
      const { token } = await makeSuperAdmin('sj-404@example.com')
      for (const id of ['notification-recovery', 'does-not-exist'])
        await request(app.getHttpServer())
          .get(`${LIST}/${id}/runs`)
          .set('Authorization', `Bearer ${token}`)
          .expect(404)
      await request(app.getHttpServer())
        .get(`${LIST}/${encodeURIComponent('../queues')}/runs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400)
    })
  })
})
