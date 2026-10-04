import express, { type RequestHandler } from 'express'
import request from 'supertest'

import { BULL_BOARD_CONTENT_SECURITY_POLICY } from '@amcore/shared'

import {
  BOARD_LOCALE_HEADER,
  type BoardRequestLocals,
  chainBoardMiddleware,
  createBullBoardBoundary,
} from './bull-board-boundary.middleware'
import type { BoardEvent } from './bull-board-events'

function appWith(
  locals: Partial<BoardRequestLocals> = {},
  events: BoardEvent[] = []
): { app: express.Express; reached: string[] } {
  const reached: string[] = []
  const app = express()
  const seed: RequestHandler = (_req, res, next) => {
    Object.assign(res.locals, locals)
    next()
  }
  const router: RequestHandler = (req, res) => {
    reached.push(`${req.method} ${req.path}`)
    res.status(200).json({ reached: req.path, locale: req.headers[BOARD_LOCALE_HEADER] ?? null })
  }
  app.use(
    '/admin/queues',
    chainBoardMiddleware(
      seed,
      createBullBoardBoundary((event) => events.push(event)),
      router
    )
  )
  return { app, reached }
}

describe('board boundary middleware', () => {
  it.each(['put', 'post', 'patch', 'delete', 'options'] as const)(
    'answers %s with 405 and never reaches the router',
    async (verb) => {
      const { app, reached } = appWith()
      const res = await request(app)[verb]('/admin/queues/api/queues/email/pause')
      expect(res.status).toBe(405)
      expect(res.headers.allow).toBe('GET, HEAD')
      expect(res.text).toBe('')
      expect(reached).toEqual([])
    }
  )

  it('answers a PUT with a JSON body without hanging', async () => {
    const { app, reached } = appWith()
    const res = await request(app).put('/admin/queues/api/queues/pause').send({})
    expect(res.status).toBe(405)
    expect(reached).toEqual([])
  })

  it('lets the reviewed GET paths reach the router and nothing else', async () => {
    const { app, reached } = appWith()
    await request(app).get('/admin/queues/api/queues?status=failed').expect(200)
    await request(app).get('/admin/queues/api/queues/email/1').expect(200)
    await request(app).get('/admin/queues/').expect(200)
    await request(app).get('/admin/queues/queue/email/1').expect(200)
    await request(app).get('/admin/queues/static/js/main.js').expect(200)
    expect(reached).toHaveLength(5)
    for (const path of ['/api/redis/stats', '/api/queues/email/workers', '/api/job-schedulers']) {
      const res = await request(app).get(`/admin/queues${path}`)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: { key: 'ERRORS.QUEUE_NOT_FOUND' } })
    }
    expect(reached).toHaveLength(5)
  })

  it('rejects an out-of-bounds query before the router runs', async () => {
    const { app, reached } = appWith()
    const res = await request(app).get('/admin/queues/api/queues?jobsPerPage=100000')
    expect(res.status).toBe(400)
    expect(reached).toEqual([])
  })

  it('answers job logs with the fixed message, in the context locale, without the router', async () => {
    const english = await request(appWith().app).get('/admin/queues/api/queues/email/1/logs')
    expect(english.body).toEqual(['Logs are not displayed in this board.'])
    const { app, reached } = appWith({
      boardContext: { basePath: '/b', locale: 'ru', returnHref: '/c' },
    })
    const russian = await request(app).get('/admin/queues/api/queues/email/1/logs')
    expect(russian.body).toEqual(['Журналы в этой панели не отображаются.'])
    expect(reached).toEqual([])
  })

  it('sets the board headers on every response and replaces an earlier CSP', async () => {
    const { app } = appWith()
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'self' https:")
      next()
    })
    for (const path of ['/', '/api/queues', '/static/js/a.js', '/nope']) {
      const res = await request(app).get(`/admin/queues${path}`)
      expect(res.headers['content-security-policy']).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBe('DENY')
      expect(res.headers['referrer-policy']).toBe('no-referrer')
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    }
    const api = await request(app).get('/admin/queues/api/queues')
    expect(api.headers['cache-control']).toBe('private, no-store')
    const asset = await request(app).get('/admin/queues/static/js/a.js')
    expect(asset.headers['cache-control']).toBe('private, no-cache')
  })

  it('overwrites a client-sent internal locale header with the validated one', async () => {
    const forged = await request(appWith().app)
      .get('/admin/queues/api/queues')
      .set(BOARD_LOCALE_HEADER, '<script>')
    expect(forged.body.locale).toBeNull()
    const { app } = appWith({ boardContext: { basePath: '/b', locale: 'ru', returnHref: '/c' } })
    const real = await request(app).get('/admin/queues/api/queues').set(BOARD_LOCALE_HEADER, 'en')
    expect(real.body.locale).toBe('ru')
  })

  it('reports the entry page opening, once, without any content', async () => {
    const events: BoardEvent[] = []
    const { app } = appWith({ boardCredential: 'bearer', boardActorId: 'actor-1' }, events)
    await request(app).get('/admin/queues/api/queues')
    await request(app).get('/admin/queues/')
    await request(app).get('/admin/queues/queue/email/9')
    expect(events).toEqual([
      { event: 'bull_board.entry_opened', credential: 'bearer', actorId: 'actor-1' },
      { event: 'bull_board.entry_opened', credential: 'bearer', actorId: 'actor-1' },
    ])
  })
})
