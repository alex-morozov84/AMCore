import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import express from 'express'

import { createBullBoardEdgeGuard } from './bull-board-edge.middleware'

/** A real HTTP listener on IPv4 with the same order as `main.ts`: guard, parser, then CORS-like headers. */
async function serve(): Promise<{ base: string; server: Server; parsed: () => number }> {
  let parsed = 0
  const app = express()
  app.use('/admin/queues', createBullBoardEdgeGuard())
  app.use(express.json())
  app.use((req, res, next) => {
    // What Helmet and CORS would do after the guard.
    res.setHeader('Content-Security-Policy', "default-src 'self'")
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Access-Control-Allow-Origin', 'https://app.example.test')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE')
      res.status(204).end()
      return
    }
    next()
  })
  app.get('/admin/queues/static/ok.js', (_req, res) => {
    // What the boundary does for a static file before the static middleware answers.
    res.setHeader('Cache-Control', 'private, no-cache')
    res.type('js').send('1')
  })
  app.get('/admin/queues/static/missing.js', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-cache')
    res.status(404).json({ error: { key: 'ERRORS.QUEUE_NOT_FOUND' } })
  })
  app.all('/admin/queues/*path', (req, res) => {
    parsed += 1
    res.status(200).json({ ok: true })
  })
  app.all('/other', (_req, res) => res.json({ other: true }))
  // A parser failure of the rest of the API stays the rest of the API's.
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response) => {
    res.status(error.status ?? 500).json({ message: error.message })
  })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, server, parsed: () => parsed }
}

describe('board edge guard', () => {
  let ctx: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    ctx = await serve()
  })
  afterAll(async () => {
    await new Promise((resolve) => ctx.server.close(resolve))
  })

  it('answers a preflight with the board refusal before any CORS handler', async () => {
    const res = await fetch(`${ctx.base}/admin/queues/api/queues`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.test', 'access-control-request-method': 'PUT' },
    })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])(
    'refuses %s with a body before the parser',
    async (method) => {
      const res = await fetch(`${ctx.base}/admin/queues/api/queues`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: '{"x":CANARY_BODY}',
      })
      expect(res.status).toBe(405)
      expect(await res.text()).toBe('')
    }
  )

  it('does not parse, or echo, the body of an allowed GET', async () => {
    const res = await fetch(`${ctx.base}/admin/queues/api/queues`, {
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('CANARY')
  })

  it("puts the board's headers on every response, replacing the later ones, and drops CORS", async () => {
    const res = await fetch(`${ctx.base}/admin/queues/api/queues`, {
      headers: { origin: 'https://app.example.test' },
    })
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('refuses an undecodable path with the board error, before the routing layer', async () => {
    const res = await fetch(`${ctx.base}/admin/queues/static/%E0%A4%A.js`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { key: 'ERRORS.INVALID_QUERY_PARAM' } })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('keeps the one cache choice the board makes: a successful static file revalidates', async () => {
    const ok = await fetch(`${ctx.base}/admin/queues/static/ok.js`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('private, no-cache')
    expect(ok.headers.get('referrer-policy')).toBe('no-referrer')
    const head = await fetch(`${ctx.base}/admin/queues/static/ok.js`, { method: 'HEAD' })
    expect(head.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('never stores a failed static answer, even if the boundary had marked it revalidating', async () => {
    const missing = await fetch(`${ctx.base}/admin/queues/static/missing.js`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('private, no-store')
  })

  it('leaves every other path alone', async () => {
    const res = await fetch(`${ctx.base}/other`, {
      headers: { origin: 'https://app.example.test' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.test')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    const bad = await fetch(`${ctx.base}/other`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    })
    expect(bad.status).toBe(400)
  })
})
