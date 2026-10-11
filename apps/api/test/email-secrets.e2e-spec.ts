import type { INestApplication } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import request from 'supertest'

import { createInvitationOperationId } from '@amcore/shared'

import { EmailService } from '../src/infrastructure/email/email.service'
import { QueueName } from '../src/infrastructure/queue/constants/queues.constant'
import { QueueService } from '../src/infrastructure/queue/queue.service'
import type { PrismaService } from '../src/prisma'

import { observeDirectEmails, queuedTemplate, waitForEmailCondition } from './email-secrets.helpers'
import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

/**
 * EQS-02 — secret-bearing emails are sent directly (EmailService.sendNow) and
 * must NEVER be enqueued. This proves end-to-end (real HTTP → real EmailService
 * → real QueueService/BullMQ) that password-reset, email-verification, and
 * org-invite flows leave no token-bearing job in the `email` queue.
 *
 * The email queue is paused for the suite so jobs accumulate (the EmailProcessor
 * cannot drain them), letting us inspect every job's data deterministically.
 */
describe('Email secret payloads (e2e — EQS-02)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let emailQueue: Queue
  let direct: ReturnType<typeof observeDirectEmails>

  const SECRET_MARKERS = ['token=', 'resetUrl', 'verificationUrl', 'acceptUrl']

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
    emailQueue = app.get(QueueService).getQueue(QueueName.EMAIL)!
    // Pause so the EmailProcessor does not consume jobs before we inspect them.
    await emailQueue.pause()
    direct = observeDirectEmails(app.get(EmailService))
  }, 120000)

  afterAll(async () => {
    direct?.restore()
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await direct.reset()
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    await emailQueue.drain(true) // clear waiting + delayed between tests
  })

  async function allEmailJobs(): Promise<Job[]> {
    // No type filter → every job in every state (robust to wait/paused aliases).
    return emailQueue.getJobs()
  }

  async function tokenBearingJobs(): Promise<Job[]> {
    const jobs = await allEmailJobs()
    return jobs.filter((job) => {
      const serialized = JSON.stringify(job.data ?? {})
      return SECRET_MARKERS.some((marker) => serialized.includes(marker))
    })
  }

  async function registerUser(email: string): Promise<{ accessToken: string }> {
    const res = (await direct.operation(
      'email-verification',
      email,
      async () =>
        await request(app.getHttpServer())
          .post('/auth/register')
          .send({ email, password: 'StrongP@ss123' })
          .expect(201)
    )) as request.Response
    await waitForEmailCondition(
      async () =>
        (await allEmailJobs()).some(
          (job) => queuedTemplate(job.data) === 'welcome' && job.data.payload.to === email
        ),
      'welcome enqueue'
    )
    return res.body as { accessToken: string }
  }

  it('register: queues the (non-secret) welcome email but no verification token job', async () => {
    await registerUser('user@example.com')

    const jobs = await allEmailJobs()
    // Sanity: the queue path works — welcome IS enqueued.
    expect(jobs.some((j) => queuedTemplate(j.data) === 'welcome')).toBe(true)
    // Verification went out via direct sendNow, not the queue.
    expect(await tokenBearingJobs()).toHaveLength(0)
    expect(jobs.some((j) => queuedTemplate(j.data) === 'email-verification')).toBe(false)
  })

  it('forgot-password: enqueues no reset-token job', async () => {
    await registerUser('reset@example.com')

    await direct.operation(
      'password-reset',
      'reset@example.com',
      async () =>
        await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .send({ email: 'reset@example.com' })
          .expect(200)
    )

    expect(await tokenBearingJobs()).toHaveLength(0)
    const jobs = await allEmailJobs()
    expect(jobs.some((j) => queuedTemplate(j.data) === 'password-reset')).toBe(false)
  })

  it('resend-verification: enqueues no verification-token job', async () => {
    await registerUser('resend@example.com')
    await emailQueue.drain(true) // drop the welcome job from registration

    await direct.operation(
      'email-verification',
      'resend@example.com',
      async () =>
        await request(app.getHttpServer())
          .post('/auth/resend-verification')
          .send({ email: 'resend@example.com' })
          .expect(200)
    )

    expect(await tokenBearingJobs()).toHaveLength(0)
  })

  it('org invite: enqueues no accept-token job', async () => {
    const token = (await registerUser('admin@example.com')).accessToken

    const orgId = (
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' })
        .expect(201)
    ).body.id as string

    const orgToken = (
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/switch`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.accessToken as string

    await emailQueue.drain(true) // drop the welcome job from registration

    await direct.operation(
      'org-invite',
      'invitee@example.com',
      async () =>
        await request(app.getHttpServer())
          .post(`/organizations/${orgId}/invites`)
          .set('X-Invitation-Operation-Id', createInvitationOperationId())
          .set('Authorization', `Bearer ${orgToken}`)
          .send({ email: 'invitee@example.com' })
          .expect(202)
    )

    expect(await tokenBearingJobs()).toHaveLength(0)
  })
})
