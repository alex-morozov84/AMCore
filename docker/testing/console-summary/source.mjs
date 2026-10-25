import { URL } from 'node:url'
import { setTimeout } from 'node:timers'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire('/app/package.json')
const Redis = require('ioredis')
const redis = new Redis('redis://redis:6379')
const key = 'amcore:console-summary-fixture'
const paths = new Set(
  [
    '/admin/overview',
    '/admin/background-work/queues',
    '/admin/background-work/works',
    '/admin/background-work/scheduled-jobs',
    '/admin/integrations',
  ].map((p) => `/api/v1${p}`)
)

function empty(path, data) {
  if (path.endsWith('/works'))
    return data.map((w) => ({
      ...w,
      paused: false,
      counts:
        w.counts &&
        Object.fromEntries(Object.keys(w.counts).map((k) => [k, { value: 0, truncated: false }])),
    }))
  if (path.endsWith('/queues'))
    return {
      ...data,
      queues: data.queues.map((q) =>
        q.status === 'available'
          ? {
              ...q,
              paused: false,
              counts: Object.fromEntries(Object.keys(q.counts).map((k) => [k, 0])),
            }
          : q
      ),
    }
  if (path.endsWith('/scheduled-jobs'))
    return {
      ...data,
      jobs: data.jobs.map((j) => ({
        ...j,
        result: { state: 'none' },
        freshness: { state: 'fresh', dueAt: new Date().toISOString() },
      })),
    }
  if (path.endsWith('/integrations'))
    return {
      ...data,
      items: data.items.map((i) => ({ ...i, configuration: 'disabled', source: 'ok' })),
    }
  return data
}
function change(mode, path, data) {
  data = empty(path, data)
  if (mode === 'many' && path.endsWith('/scheduled-jobs'))
    return {
      ...data,
      jobs: data.jobs.slice(0, 7).map((j) => ({
        ...j,
        config: {
          state: 'enabled',
          reportedAt: '2026-10-25T12:00:00.000Z',
          scheduleTimeZone: 'UTC',
        },
        result: {
          state: 'failed',
          startedAt: '2026-10-25T12:00:00.000Z',
          durationMs: 10,
          code: null,
          summary: null,
        },
      })),
    }
  return data
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}
createServer((req, res) => {
  if (req.url === '/health') return send(res, 200, { ok: true })
  const path = new URL(req.url, 'http://api:5002').pathname
  const upstream = request(
    {
      hostname: 'api',
      port: 5002,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: 'api:5002', 'accept-encoding': 'identity' },
    },
    (result) => {
      // All auth and non-source traffic use the real API. Faults require a real authorized 200.
      if (req.method !== 'GET' || !paths.has(path) || result.statusCode !== 200) {
        res.writeHead(result.statusCode, result.headers)
        result.pipe(res)
        return
      }
      let body = '',
        bytes = 0
      result.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > 2 * 1024 * 1024) result.destroy()
        else body += chunk
      })
      result.on('end', async () => {
        try {
          const mode = (await redis.get(key)) ?? 'pass'
          await redis.hincrby(`${key}:reads`, path, 1)
          if (mode === 'all500' || (mode === 'queues500' && path.endsWith('/queues')))
            return send(res, 500, {})
          if (mode === 'integrations401' && path.endsWith('/integrations'))
            return send(res, 401, {})
          if (mode === 'malformed' && path.endsWith('/integrations')) return send(res, 200, {})
          if (mode === 'retry' && path.endsWith('/scheduled-jobs'))
            return send(res, 429, {}, { 'retry-after': '2' })
          if (mode === 'slow' && path.endsWith('/scheduled-jobs'))
            await new Promise((resolve) => setTimeout(resolve, 1200))
          const data = JSON.parse(body)
          send(res, 200, mode === 'pass' ? data : change(mode, path, data))
        } catch {
          if (!res.headersSent) send(res, 502, {})
        }
      })
      result.on('error', () => {
        if (!res.headersSent) send(res, 502, {})
      })
    }
  )
  upstream.on('error', () => {
    if (!res.headersSent) send(res, 502, {})
  })
  req.pipe(upstream)
}).listen(8098, '0.0.0.0')
