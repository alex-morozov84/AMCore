import { writeFileSync } from 'node:fs'

import type { Page, Request, TestInfo } from '@playwright/test'

import { activeTarget } from './managed-target.mjs'

/** Path attachments survive list-only reporting; callers supply only sanitized fields. */
export async function saveContextDiagnostics(
  info: TestInfo,
  name:
    'adoption-authority-counts' | 'recipient-probe-counts' | 'session-fence' | 'locale-metadata',
  sanitized: Record<string, unknown>
) {
  const path = info.outputPath(`${name}.json`)
  writeFileSync(
    path,
    JSON.stringify({
      meta: {
        sourceHash: activeTarget().sourceHash,
        testId: info.testId,
        file: info.file.split('/').at(-1),
        statusAtCapture: info.status,
      },
      ...sanitized,
    }),
    { mode: 0o600 }
  )
  await info.attach(name, { path, contentType: 'application/json' })
}

const segments = new Set([
  'api',
  'product-access',
  'bootstrap',
  'organizations',
  'context',
  'members',
  'roles',
  'invites',
  'role-choices',
  'access',
  'api-keys',
  'capabilities',
  'creation-policy',
  'creation-results',
  'invite-operations',
  'reissue',
])
interface ReadRecord {
  id: number
  method: string
  route: string
  state: 'started' | 'response' | 'finished' | 'failed'
  status?: number
  errorCode?: string
  retryAfter?: string
  events: Array<{ type: string; phase: string; ms: number }>
}

/** Correlated bounded lifecycle, including unfinished/aborted requests; never bodies or identities. */
export function observeContextReads(page: Page, phase: () => string = () => 'journey') {
  const started = performance.now()
  const records: ReadRecord[] = []
  const byRequest = new WeakMap<Request, ReadRecord>()
  const pending = new Set<Promise<void>>()
  let sequence = 0
  let truncated = 0
  let orphanEvents = 0
  const event = (record: ReadRecord, type: string) => {
    if (record.events.length < 4)
      record.events.push({ type, phase: phase(), ms: Math.round(performance.now() - started) })
  }
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (!path.startsWith('/api/product-access/')) return
    const record: ReadRecord = {
      id: ++sequence,
      method: request.method(),
      state: 'started',
      events: [],
      route: path
        .split('/')
        .map((part) => (!part || segments.has(part) ? part : '<id>'))
        .join('/'),
    }
    event(record, 'start')
    byRequest.set(request, record)
    records.push(record)
    if (records.length > 64) {
      records.shift()
      truncated++
    }
  })
  page.on('response', (response) => {
    const record = byRequest.get(response.request())
    if (!record) {
      if (new URL(response.url()).pathname.startsWith('/api/product-access/')) orphanEvents++
      return
    }
    record.status = response.status()
    record.state = 'response'
    event(record, 'response')
    const read = (async () => {
      const body = response.ok() ? undefined : await response.json().catch(() => undefined)
      if (typeof body?.errorCode === 'string' && /^[A-Z_]{1,64}$/.test(body.errorCode))
        record.errorCode = body.errorCode
      const retryAfter = response.headers()['retry-after']
      if (/^\d{1,6}$/.test(retryAfter ?? '')) record.retryAfter = retryAfter
    })()
    pending.add(read)
    void read.then(
      () => pending.delete(read),
      () => pending.delete(read)
    )
  })
  page.on('requestfinished', (request) => {
    const record = byRequest.get(request)
    if (record) {
      record.state = 'finished'
      event(record, 'finished')
    }
  })
  page.on('requestfailed', (request) => {
    const record = byRequest.get(request)
    if (record) {
      record.state = 'failed'
      event(record, request.failure()?.errorText === 'net::ERR_ABORTED' ? 'aborted' : 'failed')
    }
  })
  return async () => {
    await Promise.allSettled(pending)
    return {
      requests: records.map((record) => ({ ...record, events: [...record.events] })),
      truncated,
      orphanEvents,
    }
  }
}
