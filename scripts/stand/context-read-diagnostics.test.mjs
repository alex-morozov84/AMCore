import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { observeContextReads } from '../../apps/web/e2e/support/context-read-diagnostics.ts'

const request = (suffix = '') => ({
  url: () =>
    `https://fixture.test/api/product-access/organizations/private-fixture-id/context${suffix}`,
  method: () => 'GET',
  failure: () => ({ errorText: 'net::ERR_ABORTED' }),
})

test('diagnostics correlate phases/completion and never retain IDs, query secrets or bodies', async () => {
  const page = new EventEmitter()
  let phase = 'before'
  const snapshot = observeContextReads(page, () => phase)
  const own = request('?token=private-fixture-value')
  page.emit('request', own)
  phase = 'after'
  page.emit('response', {
    request: () => own,
    status: () => 429,
    ok: () => false,
    headers: () => ({ 'retry-after': '1', authorization: 'private-fixture-value' }),
    json: async () => ({ errorCode: 'RATE_LIMIT_EXCEEDED', token: 'private-fixture-value' }),
  })
  page.emit('requestfinished', own)
  const result = await snapshot()
  const record = result.requests[0]
  assert.equal(record.state, 'finished')
  assert.equal(record.status, 429)
  assert.equal(record.retryAfter, '1')
  assert.equal(record.errorCode, 'RATE_LIMIT_EXCEEDED')
  assert.deepEqual(
    record.events.map((e) => [e.type, e.phase]),
    [
      ['start', 'before'],
      ['response', 'after'],
      ['finished', 'after'],
    ]
  )
  assert.equal(record.route, '/api/product-access/organizations/<id>/context')
  assert.ok(record.events.every((e) => e.ms >= 0))
  assert.ok(!JSON.stringify(result).includes('private-fixture'))
})

test('aborted and unfinished requests are distinct from completed responses', async () => {
  const page = new EventEmitter()
  const snapshot = observeContextReads(page)
  const aborted = request(),
    unfinished = request()
  page.emit('request', aborted)
  page.emit('request', unfinished)
  page.emit('requestfailed', aborted)
  const result = await snapshot()
  assert.deepEqual(
    result.requests.map((r) => r.state),
    ['failed', 'started']
  )
  assert.equal(result.requests[0].events.at(-1).type, 'aborted')
  assert.ok(result.requests.every((r) => r.status === undefined))
})

test('bounded journal reports truncation and observed responses without a start', async () => {
  const page = new EventEmitter()
  const snapshot = observeContextReads(page)
  for (let i = 0; i < 70; i++) page.emit('request', request())
  const orphan = request()
  page.emit('response', { request: () => orphan, url: orphan.url })
  const result = await snapshot()
  assert.equal(result.requests.length, 64)
  assert.equal(result.requests[0].id, 7)
  assert.equal(result.truncated, 6)
  assert.equal(result.orphanEvents, 1)
})
