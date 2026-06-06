import type { INestApplication } from '@nestjs/common'
import { Body, Controller, HttpCode, Injectable, Post } from '@nestjs/common'
import request from 'supertest'

import { AuthType } from '@amcore/shared'

import { Auth } from '../src/core/auth/decorators/auth.decorator'
import { Idempotent } from '../src/infrastructure/idempotency'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, cleanOrgData, type E2ETestContext, teardownE2ETest } from './helpers'
import { setupIdempotencyTestApp } from './idempotency-test-app'

@Injectable()
class SampleIdempotencyService {
  private executions = 0

  async create(body: {
    amount: number
    delayMs?: number
  }): Promise<{ execution: number; amount: number }> {
    this.executions += 1
    if (body.delayMs) await new Promise((resolve) => setTimeout(resolve, body.delayMs))
    return { execution: this.executions, amount: body.amount }
  }
}

@Controller('idempotency/sample')
class SampleIdempotencyController {
  constructor(private readonly service: SampleIdempotencyService) {}

  @Post('orders')
  @HttpCode(201)
  @Auth(AuthType.None)
  @Idempotent({ scope: 'sample-orders' })
  create(@Body() body: { amount: number; delayMs?: number }) {
    return this.service.create(body)
  }
}

describe('HTTP idempotency (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

  beforeAll(async () => {
    context = await setupIdempotencyTestApp(SampleIdempotencyController, [SampleIdempotencyService])
    app = context.app
    prisma = context.prisma
  }, 120000)

  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  it('supports first call, replay, mismatch, and in-flight conflict', async () => {
    const key = 'idem-order-1'
    const first = await request(app.getHttpServer())
      .post('/idempotency/sample/orders')
      .set('Idempotency-Key', key)
      .send({ amount: 10 })
      .expect(201)
    expect(first.body.execution).toBe(1)

    const replay = await request(app.getHttpServer())
      .post('/idempotency/sample/orders')
      .set('Idempotency-Key', key)
      .send({ amount: 10 })
      .expect(201)
    expect(replay.body).toEqual(first.body)
    expect(replay.headers['idempotency-replayed']).toBe('true')

    const mismatch = await request(app.getHttpServer())
      .post('/idempotency/sample/orders')
      .set('Idempotency-Key', key)
      .send({ amount: 20 })
      .expect(422)
    expect(mismatch.body.errorCode).toBe('IDEMPOTENCY_KEY_REUSE')

    const concurrentKey = 'idem-order-2'
    const pending = request(app.getHttpServer())
      .post('/idempotency/sample/orders')
      .set('Idempotency-Key', concurrentKey)
      .send({ amount: 30, delayMs: 250 })
      .then((response) => response)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const conflict = await request(app.getHttpServer())
      .post('/idempotency/sample/orders')
      .set('Idempotency-Key', concurrentKey)
      .send({ amount: 30, delayMs: 250 })
      .expect(409)
    expect(conflict.body.errorCode).toBe('IDEMPOTENCY_CONFLICT')

    const completed = await pending
    expect(completed.status).toBe(201)
  })
})
