import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import { type Job, Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import request from 'supertest'

import type { PrismaService } from '../src/prisma'

/** Mount path of the board in the e2e harness (it applies no global prefix). */
export const BOARD = '/admin/queues'

/** A value that must never appear in any board response. */
export const CANARY = 'CANARY_BOARD_SECRET_7f3a'

export function queueOf(app: INestApplication, name: string): Queue {
  return app.get<Queue>(getQueueToken(name), { strict: false })
}

/** Registers a user, promotes it to SUPER_ADMIN in place and returns its refresh cookie. */
export async function superAdminCookie(
  app: INestApplication,
  prisma: PrismaService,
  email = 'board-admin@example.com',
  prefix = ''
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`${prefix}/auth/register`)
    .send({ email, password: 'StrongP@ss123' })
    .expect(201)
  const setCookie = res.headers['set-cookie'] as unknown as string[]
  const cookie = setCookie.find((c) => c.startsWith('refresh_token='))?.split(';')[0]
  if (!cookie) throw new Error('no refresh_token cookie in response')
  await prisma.user.update({
    where: { id: res.body.user.id as string },
    data: { systemRole: 'SUPER_ADMIN' },
  })
  return cookie
}

/**
 * Fails one job of `queue` through a real worker, so the job carries a genuine `failedReason` and
 * stack trace made of the canary. Returns the failed job.
 */
export async function failOneJob(queue: Queue, data: unknown, redisUrl: string): Promise<Job> {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })
  const worker = new Worker(
    queue.name,
    () => {
      throw new Error(`boom ${CANARY}`)
    },
    { connection, prefix: 'amcore' }
  )
  try {
    const failed = new Promise<void>((resolve) => worker.once('failed', () => resolve()))
    const job = await queue.add('canary-job', data, { attempts: 1, removeOnFail: false })
    await job.log(`LOG LINE ${CANARY}`)
    await failed
    return job
  } finally {
    await worker.close()
    connection.disconnect()
  }
}
