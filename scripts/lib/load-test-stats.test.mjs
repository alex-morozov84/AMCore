import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

import { readRecords, routeClass, windowStats } from '../load-test/stats.mjs'

const rec = (ts, uri, duration = 0.01, status = 200) =>
  JSON.stringify({ ts, duration, status, request: { uri } })
const dir = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'lt-stats-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body)
  return d
}

test('window selection reads the current and rolled plain and gzip files once each', () => {
  const d = dir({
    'load-test-access-2026-10-25T10-00-00.000.log.gz': gzipSync(
      `${rec(99, '/a')}\n${rec(100, '/a')}\n`
    ),
    'load-test-access-2026-10-25T10-05-00.000.log': `${rec(101, '/b')}\n`,
    'load-test-access.log': `${rec(102, '/b')}\n${rec(110, '/b')}\n`,
    'access.log': `${rec(105, '/other-file-ignored')}\n`,
  })
  const s = windowStats(readRecords(d), 100, 110)
  assert.equal(s.requests, 3)
  assert.deepEqual(Object.keys(s.routes), ['/a', '/b'])
  assert.equal(s.routes['/b'].n, 2)
})

test('an empty window is an error, never zero requests', () => {
  const d = dir({ 'load-test-access.log': `${rec(10, '/a')}\n` })
  assert.throws(() => windowStats(readRecords(d), 100, 200), /no test-entry records/)
  assert.throws(() => windowStats([], 200, 100), /empty or reversed/)
})

test('a corrupt or incomplete record fails the whole window', () => {
  assert.throws(
    () => readRecords(dir({ 'load-test-access.log': `${rec(1, '/a')}\n{"ts":` })),
    /not a JSON log record/
  )
  assert.throws(
    () => readRecords(dir({ 'load-test-access.log': '{"ts":1,"status":200}\n' })),
    /lacks ts, duration or status/
  )
})

test('percentiles are nearest-rank in milliseconds and status codes are counted', () => {
  const lines = Array.from({ length: 100 }, (_, i) =>
    rec(100 + i / 100, '/x', (i + 1) / 1000, i < 5 ? 429 : 200)
  )
  const s = windowStats(readRecords(dir({ 'load-test-access.log': lines.join('\n') })), 100, 102)
  assert.equal(Math.round(s.all.p50), 50)
  assert.equal(Math.round(s.all.p95), 95)
  assert.equal(Math.round(s.all.p99), 99)
  assert.deepEqual(s.status, { 200: 95, 429: 5 })
})

test('exact fractional window edges: requests just outside count nowhere', () => {
  // The run-step passes the k6 window unrounded; a record at the edge stays out.
  const lines = [
    rec(100.2, '/x', 0.9), // finished before the window (e.g. the setup sign-in)
    rec(100.3, '/x', 0.01),
    rec(110.7, '/x', 0.03),
    rec(110.8, '/x', 0.9), // finished after the end: an interrupted iteration's request
  ]
  const s = windowStats(
    readRecords(dir({ 'load-test-access.log': lines.join('\n') })),
    100.25,
    110.75
  )
  assert.equal(s.requests, 2)
  assert.equal(Math.round(s.all.p95), 30)
})

test('route classes fold query, organization ids and the locale prefix', () => {
  assert.equal(
    routeClass('/api/product-access/organizations/cmabc123/context?x=1'),
    '/api/product-access/organizations/:id/context'
  )
  assert.equal(routeClass('/en/settings/sessions'), '/:locale/settings/sessions')
  assert.equal(routeClass('/settings/sessions'), '/settings/sessions')
  assert.equal(routeClass('/api/v1/admin/users?limit=20'), '/api/v1/admin/users')
})
