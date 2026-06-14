import { createHmac } from 'node:crypto'

import { Body, Controller, HttpCode, type INestApplication, Post, Req } from '@nestjs/common'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import request from 'supertest'

import { AuthType } from '@amcore/shared'

import { REQUEST_BODY_LIMIT_BYTES } from '../src/bootstrap/configure-body-parser'
import { Auth } from '../src/core/auth/decorators/auth.decorator'
import { VerifyWebhook } from '../src/infrastructure/webhooks'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, cleanOrgData, type E2ETestContext, teardownE2ETest } from './helpers'
import { setupWebhookTestApp } from './webhook-test-app'

/** Ordinary JSON route: echoes a fixed body so a parsed request returns 200. */
@Controller('body-size')
@SkipThrottle()
class EchoController {
  @Post('echo')
  @HttpCode(200)
  @Auth(AuthType.None)
  echo(@Body() _body: { padding?: string }): { ok: true } {
    return { ok: true }
  }
}

/** Raw-body webhook route: proves the limit + raw-byte preservation together. */
@Controller('body-size/webhooks')
class WebhookSizeController {
  @Post('stripe')
  @HttpCode(200)
  @Auth(AuthType.None)
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  @VerifyWebhook('stripe')
  handle(@Req() req: { body: { id: string } }): { ok: true; id: string } {
    return { ok: true, id: req.body.id }
  }
}

describe('Request body size limit (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  const secret = 'whsec_test'

  beforeAll(async () => {
    process.env.WEBHOOK_STRIPE_SECRET = secret
    process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = '300'
    process.env.WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS = '300'
    context = await setupWebhookTestApp([EchoController, WebhookSizeController])
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

  describe('ordinary JSON', () => {
    it('accepts a body exactly at the limit', async () => {
      const body = jsonBodyOfSize(REQUEST_BODY_LIMIT_BYTES)
      expect(Buffer.byteLength(body)).toBe(REQUEST_BODY_LIMIT_BYTES)

      const res = await request(app.getHttpServer())
        .post('/body-size/echo')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200)
      expect(res.body).toEqual({ ok: true })
    })

    it('rejects a body one byte over the limit with 413 PAYLOAD_TOO_LARGE', async () => {
      const body = jsonBodyOfSize(REQUEST_BODY_LIMIT_BYTES + 1)
      expect(Buffer.byteLength(body)).toBe(REQUEST_BODY_LIMIT_BYTES + 1)

      const res = await request(app.getHttpServer())
        .post('/body-size/echo')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(413)
      expect(res.body.errorCode).toBe('PAYLOAD_TOO_LARGE')
    })
  })

  describe('urlencoded (Apple form_post parser path)', () => {
    it('accepts a urlencoded body exactly at the limit', async () => {
      const body = urlencodedBodyOfSize(REQUEST_BODY_LIMIT_BYTES)
      expect(Buffer.byteLength(body)).toBe(REQUEST_BODY_LIMIT_BYTES)

      const res = await request(app.getHttpServer())
        .post('/body-size/echo')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body)
        .expect(200)
      expect(res.body).toEqual({ ok: true })
    })

    it('rejects a urlencoded body one byte over the limit with 413', async () => {
      const body = urlencodedBodyOfSize(REQUEST_BODY_LIMIT_BYTES + 1)
      expect(Buffer.byteLength(body)).toBe(REQUEST_BODY_LIMIT_BYTES + 1)

      const res = await request(app.getHttpServer())
        .post('/body-size/echo')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body)
        .expect(413)
      expect(res.body.errorCode).toBe('PAYLOAD_TOO_LARGE')
    })
  })

  describe('signed webhook (raw body)', () => {
    it('accepts a signed body exactly at the limit (raw bytes preserved)', async () => {
      const payload = jsonBodyOfSize(REQUEST_BODY_LIMIT_BYTES, { id: 'evt_at_limit' })
      expect(Buffer.byteLength(payload)).toBe(REQUEST_BODY_LIMIT_BYTES)
      const timestamp = Math.floor(Date.now() / 1000)

      const res = await request(app.getHttpServer())
        .post('/body-size/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', stripeSignature(payload, timestamp, secret))
        .send(payload)
        .expect(200)
      expect(res.body).toEqual({ ok: true, id: 'evt_at_limit' })
    })

    it('rejects an over-limit body with 413 before signature verification', async () => {
      const payload = jsonBodyOfSize(REQUEST_BODY_LIMIT_BYTES + 1, { id: 'evt_over_limit' })
      expect(Buffer.byteLength(payload)).toBe(REQUEST_BODY_LIMIT_BYTES + 1)
      const timestamp = Math.floor(Date.now() / 1000)

      const res = await request(app.getHttpServer())
        .post('/body-size/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', stripeSignature(payload, timestamp, secret))
        .send(payload)
        .expect(413)
      expect(res.body.errorCode).toBe('PAYLOAD_TOO_LARGE')
    })
  })
})

/**
 * Build a JSON document whose serialized form is exactly `totalBytes` long by
 * padding a single ASCII field. ASCII keeps one char == one byte, so the byte
 * length is deterministic for the boundary assertions.
 */
function jsonBodyOfSize(totalBytes: number, seed: Record<string, unknown> = {}): string {
  const base = JSON.stringify({ ...seed, padding: '' })
  const padLength = totalBytes - Buffer.byteLength(base)
  if (padLength < 0) throw new Error(`seed already exceeds ${totalBytes} bytes`)
  return JSON.stringify({ ...seed, padding: 'a'.repeat(padLength) })
}

/** Build a urlencoded body (`padding=aaa…`) of exactly `totalBytes` ASCII bytes. */
function urlencodedBodyOfSize(totalBytes: number): string {
  const prefix = 'padding='
  const padLength = totalBytes - prefix.length
  if (padLength < 0) throw new Error(`prefix already exceeds ${totalBytes} bytes`)
  return prefix + 'a'.repeat(padLength)
}

function stripeSignature(payload: string, timestamp: number, secret: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${digest}`
}
