import { BullBoardModule } from '@bull-board/nestjs'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import request from 'supertest'

import { BULL_BOARD_CONTEXT_HEADER, SUPPORTED_LOCALES } from '@amcore/shared'

import { configureHttp } from '../src/bootstrap/configure-http'
import { createHttpAdapter } from '../src/bootstrap/create-http-adapter'
import { createBullBoardAuthMiddleware } from '../src/infrastructure/queue/dashboard/bull-board-auth.middleware'
import type { BullBoardAuthService } from '../src/infrastructure/queue/dashboard/bull-board-auth.service'
import {
  chainBoardMiddleware,
  createBullBoardBoundary,
} from '../src/infrastructure/queue/dashboard/bull-board-boundary.middleware'
import { boardCopy } from '../src/infrastructure/queue/dashboard/bull-board-copy'
import { createBullBoardEdgeGuard } from '../src/infrastructure/queue/dashboard/bull-board-edge.middleware'
import { QueueBoardFastifyAdapter } from '../src/infrastructure/queue/dashboard/bull-board-fastify-adapter'
import {
  BOARD_HOOKS,
  BOARD_UI_CONFIG,
} from '../src/infrastructure/queue/dashboard/bull-board-hooks'

import { QueueBoardAdapter } from './support/express-board-adapter'

const cookieAuth = {
  verifyAccess: async (token: string) => (token === 'allowed' ? 'authorized' : 'unauthenticated'),
} as unknown as BullBoardAuthService
const bearerAuth = {
  verify: async (token: string) =>
    token === 'allowed'
      ? { kind: 'authorized' as const, userId: 'probe' }
      : { kind: 'unauthenticated' as const },
}

const admission = chainBoardMiddleware(
  createBullBoardAuthMiddleware(cookieAuth, bearerAuth),
  createBullBoardBoundary()
)
class ProbeNativeBoardAdapter extends QueueBoardFastifyAdapter {
  constructor() {
    super(admission)
  }
}

for (const [name, makeAdapter, boardAdapter] of [
  ['express', () => new ExpressAdapter(), QueueBoardAdapter],
  [
    'fastify',
    () => createHttpAdapter('/api/v1/admin/queues', false, true),
    ProbeNativeBoardAdapter,
  ],
] as const) {
  @Module({
    imports: [
      BullBoardModule.forRoot({
        route: '/admin/queues',
        adapter: boardAdapter,
        middleware: chainBoardMiddleware(
          createBullBoardAuthMiddleware(cookieAuth, bearerAuth),
          createBullBoardBoundary()
        ),
        boardOptions: {
          validateResponses: true,
          handlerHooks: BOARD_HOOKS,
          uiConfig: BOARD_UI_CONFIG,
        },
      }),
    ],
  })
  class BoardProbeModule {}

  describe(`HTTP mounted board boundary: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    const mount = '/api/v1/admin/queues'
    beforeAll(async () => {
      const adapter = makeAdapter()
      app = await NestFactory.create(BoardProbeModule, adapter, {
        logger: false,
        abortOnError: false,
      })
      app.setGlobalPrefix('api/v1')
      if (adapter instanceof FastifyAdapter)
        await configureHttp(app as NestFastifyApplication, '/api/v1', true)
      else app.use(mount, createBullBoardEdgeGuard())
      app.enableCors({ origin: ['https://app.example.test'], credentials: true })
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })

    it('rejects CORS preflight before the global CORS plugin', async () => {
      const result = await request(app.getHttpServer())
        .options(mount + '/api/queues')
        .set('Origin', 'https://app.example.test')
        .set('Access-Control-Request-Method', 'POST')
      expect(result.status).toBe(405)
      expect(result.headers.allow).toBe('GET, HEAD')
      expect(result.headers['access-control-allow-origin']).toBeUndefined()
      expect(result.headers['access-control-allow-credentials']).toBeUndefined()
    })

    it.each([
      ['/api/queues', 200],
      ['/api/queues?page=1&page=2', 400],
      ['/api/queues?q=unknown', 400],
      ['/api/queues/probe/one/logs', 200],
      ['/api/queues/probe/one/flow', 200],
      ['/api/queues/probe/workers', 404],
      ['/unknown', 404],
      ['/api/queues/probe/pause', 404],
      ['/api/queues/probe/one%2flogs', 404],
      ['/static/missing.js', 404],
    ])('allows only bounded read routes: %s', async (path, status) => {
      const result = await request(app.getHttpServer())
        .get(mount + path)
        .auth('allowed', { type: 'bearer' })
      expect(result.status).toBe(status)
      expect(result.headers['cache-control']).toBe('private, no-store')
      expect(result.headers['x-frame-options']).toBe('DENY')
      expect(result.headers['access-control-allow-origin']).toBeUndefined()
    })
    it('rejects mutation before parsing malformed JSON', async () => {
      const result = await request(app.getHttpServer())
        .post(mount + '/api/queues/probe/clean')
        .set('Content-Type', 'application/json')
        .send('{')
      expect(result.status).toBe(405)
      expect(result.headers.allow).toBe('GET, HEAD')
      expect(result.headers['cache-control']).toBe('private, no-store')
    })
    it('rejects unauthenticated reads without disclosing body', async () => {
      const result = await request(app.getHttpServer()).get(mount + '/api/queues')
      expect(result.status).toBe(401)
      expect(result.text).toBe('')
      expect(result.headers['cache-control']).toBe('private, no-store')
    })
    it('does not fall back to valid cookie when bearer is invalid', async () => {
      const result = await request(app.getHttpServer())
        .get(mount + '/api/queues')
        .auth('invalid', { type: 'bearer' })
        .set('Cookie', 'refresh_token=allowed')
      expect(result.status).toBe(401)
      expect(result.text).toBe('')
    })

    it('rejects API-key header despite valid bearer', async () => {
      const result = await request(app.getHttpServer())
        .get(mount + '/api/queues')
        .auth('allowed', { type: 'bearer' })
        .set('x-api-key', 'probe')
      expect(result.status).toBe(401)
    })
    it('preserves HEAD body suppression', async () => {
      const result = await request(app.getHttpServer())
        .head(mount + '/api/queues')
        .auth('allowed', { type: 'bearer' })
      expect(result.status).toBe(200)
      expect(result.text).toBeUndefined()
      expect(result.headers['cache-control']).toBe('private, no-store')
    })
    it('refuses CORS preflight', async () => {
      const result = await request(app.getHttpServer())
        .options(mount + '/api/queues')
        .set('Origin', 'https://other.example')
      expect(result.status).toBe(405)
      expect(result.headers.allow).toBe('GET, HEAD')
      expect(result.headers['access-control-allow-origin']).toBeUndefined()
    })
    it('keeps malformed route error closed', async () => {
      const result = await request(app.getHttpServer())
        .get(mount + '/%FF')
        .auth('allowed', { type: 'bearer' })
      expect(result.status).toBe(400)
      expect(result.headers['cache-control']).toBe('private, no-store')
      expect(result.body).toEqual({ error: { key: 'ERRORS.INVALID_QUERY_PARAM' } })
    })

    it.each(['/api/v1/admin/queues', '/API/V1/ADMIN/QUEUES', '/Api/V1/Admin/Queues'])(
      'closes malformed aliases and refuses methods first: %s',
      async (alias) => {
        for (const method of ['get', 'head', 'post', 'options'] as const) {
          const result = await request(app.getHttpServer())
            [method](alias + '/sentinel-%FF')
            .set('Origin', 'https://app.example.test')
            .set('Content-Type', 'application/json')
            .send(method === 'post' ? '{' : undefined)
          expect(result.status).toBe(method === 'get' || method === 'head' ? 400 : 405)
          expect(result.headers['cache-control']).toBe('private, no-store')
          expect(result.headers['content-security-policy']).toBeTruthy()
          expect(result.headers['x-content-type-options']).toBe('nosniff')
          expect(result.headers['referrer-policy']).toBe('no-referrer')
          expect(result.headers['x-frame-options']).toBe('DENY')
          expect(result.headers['cross-origin-resource-policy']).toBe('same-origin')
          expect(result.headers['access-control-allow-origin']).toBeUndefined()
          expect(result.text ?? '').not.toContain('sentinel')
          expect(result.body).toEqual(
            method === 'get' ? { error: { key: 'ERRORS.INVALID_QUERY_PARAM' } } : {}
          )
          expect(result.text).toBe(
            method === 'get'
              ? JSON.stringify({ error: { key: 'ERRORS.INVALID_QUERY_PARAM' } })
              : method === 'head'
                ? undefined
                : ''
          )
          expect(result.headers.allow).toBe(
            method === 'post' || method === 'options' ? 'GET, HEAD' : undefined
          )
        }
        const valid = await request(app.getHttpServer())
          .get(alias + '/api/queues')
          .auth('allowed', { type: 'bearer' })
        expect(valid.status).toBe(200)
        expect(valid.headers['cache-control']).toBe('private, no-store')
      }
    )

    it('renders the read-only shell with its scoped stylesheet', async () => {
      const result = await request(app.getHttpServer())
        .get(mount + '/')
        .auth('allowed', { type: 'bearer' })
      expect(result.status).toBe(200)
      expect(result.headers['content-type']).toContain('text/html')
      expect(result.text).toContain('Queue board — view only')
      expect(result.text).toContain(`${mount}/static/amcore-board-display.css`)
    })
    it('renders bearer context per request without changing shared UI state', async () => {
      const context = {
        basePath: '/api/console/bull-board',
        locale: SUPPORTED_LOCALES[SUPPORTED_LOCALES.length - 1],
        returnHref: '/admin/background-work',
      }
      const [localized, defaultShell] = await Promise.all([
        request(app.getHttpServer())
          .get(mount + '/')
          .auth('allowed', { type: 'bearer' })
          .set(
            BULL_BOARD_CONTEXT_HEADER,
            Buffer.from(JSON.stringify(context)).toString('base64url')
          ),
        request(app.getHttpServer())
          .get(mount + '/')
          .auth('allowed', { type: 'bearer' }),
      ])
      expect(localized.status).toBe(200)
      expect(localized.text).toContain(boardCopy(context.locale).boardTitle)
      expect(localized.text).toContain('/api/console/bull-board/static/amcore-board-display.css')
      expect(localized.text).toContain('/admin/background-work')
      expect(defaultShell.status).toBe(200)
      expect(defaultShell.text).toContain('Queue board — view only')
      expect(defaultShell.text).not.toContain('Панель очередей — только просмотр')
      expect(defaultShell.text).not.toContain(`${context.basePath}/static/amcore-board-display.css`)
      expect(defaultShell.text).not.toContain(context.returnHref)
    })
    it.each([
      ['en-US', 'Not displayed'],
      ['en-GB', 'Not displayed'],
      ['ru-RU', 'Не отображается'],
    ])('serves pinned %s translation override', async (locale, text) => {
      const result = await request(app.getHttpServer())
        .get(`${mount}/static/locales/${locale}/messages.json`)
        .auth('allowed', { type: 'bearer' })
      expect(result.status).toBe(200)
      expect(result.body.QUEUE.INFO.NOT_SET).toBe(text)
      expect(result.headers['cache-control']).toBe('private, no-cache')
    })
    it('keeps defaults query disabled in the installed read-only asset', async () => {
      const result = await request(app.getHttpServer())
        .get(`${mount}/static/js/async/oa.cadae521aa.js`)
        .auth('allowed', { type: 'bearer' })
      expect(result.status).toBe(200)
      expect(result.text).toContain('(a.name,l&&!a.readOnlyMode),_=Object.entries(L||{})')
      expect(result.text).not.toContain('(a.name,l),_=Object.entries(L||{})')
    })
  })
}

@Module({})
class UnmountedBoardProbeModule {}

it.each(['disabled', 'worker'])('does not apply board refusal to the %s runtime', async () => {
  const adapter = createHttpAdapter('/api/v1/admin/queues', false, false)
  const app = await NestFactory.create(UnmountedBoardProbeModule, adapter, { logger: false })
  try {
    await app.init()
    await adapter.getInstance().ready()
    for (const method of ['get', 'post', 'options'] as const) {
      const result = await request(app.getHttpServer())[method]('/API/V1/ADMIN/QUEUES/sentinel-%FF')
      expect(result.status).toBe(400)
      expect(result.body.code).toBe('FST_ERR_BAD_URL')
      expect(result.headers['cache-control']).toBeUndefined()
      expect(result.headers.allow).toBeUndefined()
    }
  } finally {
    await app.close()
  }
})

it('preserves the segment boundary and unrelated malformed URL policy', async () => {
  const adapter = createHttpAdapter('/api/v1/admin/queues', false, true)
  const app = await NestFactory.create(UnmountedBoardProbeModule, adapter, { logger: false })
  try {
    await app.init()
    await adapter.getInstance().ready()
    const result = await request(app.getHttpServer()).post(
      '/API/V1/ADMIN/QUEUES-other/sentinel-%FF'
    )
    expect(result.status).toBe(400)
    expect(result.body.code).toBe('FST_ERR_BAD_URL')
    expect(result.headers['cache-control']).toBeUndefined()
    expect(result.headers.allow).toBeUndefined()
  } finally {
    await app.close()
  }
})
