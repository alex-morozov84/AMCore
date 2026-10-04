import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { AllExceptionsFilter } from '../src/common/exceptions/filters/all-exceptions.filter'
import type { PrismaService } from '../src/prisma'

import { CANARY, superAdminCookie } from './bull-board.helper'
import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'

/**
 * The board mount as production registers it: `api/v1` prefix, and the board guard, body parser,
 * Helmet and CORS in the order of `main.ts`. Requests that those global pieces would answer first
 * (a malformed body, a preflight) and refusals of the admission middleware must still carry the
 * board's contract.
 */
const BOARD_ROOT = '/api/v1/admin/queues'
const ORIGIN = 'https://app.example.test'

describe('queue board — early responses of the mount (production order)', () => {
  let context: E2ETestContext
  let app: INestApplication
  let prisma: PrismaService
  let cookie: string

  beforeAll(async () => {
    context = await setupE2ETest(undefined, { productionOrder: true })
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
    cookie = await superAdminCookie(app, prisma, 'edge-admin@example.com', '/api/v1')
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 60000)

  const server = () => request(app.getHttpServer())

  function expectBoardHeaders(headers: Record<string, string>, cache = 'private, no-store'): void {
    expect(headers['content-security-policy']).toContain("script-src 'self'")
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['cache-control']).toBe(cache)
    expect(headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['access-control-allow-origin']).toBeUndefined()
    expect(headers['access-control-allow-credentials']).toBeUndefined()
  }

  it('answers a CORS preflight with the board refusal, not the global CORS handler', async () => {
    const res = await server()
      .options(`${BOARD_ROOT}/api/queues`)
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'PUT')
    expect(res.status).toBe(405)
    expect(res.headers.allow).toBe('GET, HEAD')
    expect(res.headers['access-control-allow-methods']).toBeUndefined()
    expectBoardHeaders(res.headers)
  })

  it.each([
    ['malformed JSON', '{"x":' + CANARY + '}'],
    ['oversized JSON', JSON.stringify({ pad: 'x'.repeat(150_000) })],
  ])('refuses a POST with %s before any parser, without echoing it', async (_label, body) => {
    const res = await server()
      .post(`${BOARD_ROOT}/api/queues/email/add`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send(body)
    expect(res.status).toBe(405)
    expect(res.text).toBe('')
    expectBoardHeaders(res.headers)
  })

  it('does not parse a body on an allowed GET: no parser error, nothing echoed', async () => {
    const res = await server()
      .get(`${BOARD_ROOT}/api/queues`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send('{"x":' + CANARY + '}')
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain(CANARY)
    expectBoardHeaders(res.headers)
  })

  it('gives an admission refusal the same board headers, with and without a body (GET and HEAD)', async () => {
    for (const verb of ['get', 'head'] as const) {
      const res = await server()[verb](`${BOARD_ROOT}/api/queues`).set('Origin', ORIGIN)
      expect(res.status).toBe(401)
      expect(res.text ?? '').toBe('')
      expectBoardHeaders(res.headers)
    }
  })

  it('gives the board document and HEAD the board headers too, replacing Helmet', async () => {
    const page = await server().get(BOARD_ROOT).set('Cookie', cookie).set('Origin', ORIGIN)
    expect(page.status).toBe(200)
    expectBoardHeaders(page.headers)
    const head = await server().head(BOARD_ROOT).set('Cookie', cookie)
    expect(head.status).toBe(200)
    expect(head.text ?? '').toBe('')
    expectBoardHeaders(head.headers)
  })

  it('leaves the rest of the API alone: a malformed body there is still its own 400', async () => {
    const res = await server()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad')
    expect(res.status).toBe(400)
    expect(res.headers['content-security-policy'] ?? '').not.toContain("script-src 'self'")
    expect(res.headers['cache-control'] ?? '').not.toBe('private, no-store')
  })

  describe('static files of the board', () => {
    let asset: string

    beforeAll(async () => {
      const page = await server().get(BOARD_ROOT).set('Cookie', cookie)
      const relative = /(?:src|href)="([^"]*static[^"]+\.js)"/.exec(page.text)?.[1]
      if (!relative) throw new Error('the board page links no static script')
      asset = relative.startsWith('/') ? relative : `${BOARD_ROOT}/${relative}`
    })

    afterEach(() => jest.restoreAllMocks())

    it('serves an existing file, GET and HEAD, revalidating and with the board headers', async () => {
      const res = await server().get(asset).set('Cookie', cookie)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/javascript/)
      expectBoardHeaders(res.headers, 'private, no-cache')
      const head = await server().head(asset).set('Cookie', cookie)
      expect(head.status).toBe(200)
      expect(head.text ?? '').toBe('')
      expectBoardHeaders(head.headers, 'private, no-cache')
    })

    it('answers a missing file with the board error, not the application filter', async () => {
      const filter = jest.spyOn(AllExceptionsFilter.prototype, 'catch')
      const url = `${BOARD_ROOT}/static/js/${CANARY}.js`
      const res = await server().get(url).set('Cookie', cookie)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: { key: 'ERRORS.QUEUE_NOT_FOUND' } })
      expect(res.text).not.toContain(CANARY)
      expect(res.text).not.toContain('Cannot GET')
      expectBoardHeaders(res.headers)
      const head = await server().head(url).set('Cookie', cookie)
      expect(head.status).toBe(404)
      expect(head.text ?? '').toBe('')
      expectBoardHeaders(head.headers)
      expect(filter).not.toHaveBeenCalled()
    })

    it('answers an undecodable path with the board error too', async () => {
      const filter = jest.spyOn(AllExceptionsFilter.prototype, 'catch')
      const res = await server().get(`${BOARD_ROOT}/static/%E0%A4%A.js`).set('Cookie', cookie)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: { key: 'ERRORS.INVALID_QUERY_PARAM' } })
      expectBoardHeaders(res.headers)
      expect(filter).not.toHaveBeenCalled()
    })
  })
})
