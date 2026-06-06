import { createHmac } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Controller, HttpCode, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import request from 'supertest'

import { AuthType } from '@amcore/shared'

import { Auth } from '../src/core/auth/decorators/auth.decorator'
import { VerifyWebhook } from '../src/infrastructure/webhooks'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, cleanOrgData, type E2ETestContext, teardownE2ETest } from './helpers'
import { setupWebhookTestApp } from './webhook-test-app'

@Controller('webhooks/sample')
class SampleWebhookController {
  @Post('stripe')
  @HttpCode(200)
  @Auth(AuthType.None)
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  @VerifyWebhook('stripe')
  handle(@Req() req: { body: { id: string } }): { ok: true; id: string } {
    return { ok: true, id: req.body.id }
  }
}

describe('Webhook verification (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  const secret = 'whsec_test'

  beforeAll(async () => {
    process.env.WEBHOOK_STRIPE_SECRET = secret
    process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = '300'
    process.env.WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS = '300'
    context = await setupWebhookTestApp(SampleWebhookController)
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

  it('accepts valid signatures, rejects invalid signatures, and rejects replayed ids', async () => {
    const payload = JSON.stringify({ id: 'evt_123', object: 'event' })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = stripeSignature(payload, timestamp, secret)

    await request(app.getHttpServer())
      .post('/webhooks/sample/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload)
      .expect(200)

    const invalid = await request(app.getHttpServer())
      .post('/webhooks/sample/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${timestamp},v1=bad`)
      .send(JSON.stringify({ id: 'evt_bad', object: 'event' }))
      .expect(401)
    expect(invalid.body.errorCode).toBe('WEBHOOK_SIGNATURE_INVALID')

    const replay = await request(app.getHttpServer())
      .post('/webhooks/sample/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload)
      .expect(401)
    expect(replay.body.errorCode).toBe('WEBHOOK_REPLAY_REJECTED')
  })
})

function stripeSignature(payload: string, timestamp: number, secret: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${digest}`
}
