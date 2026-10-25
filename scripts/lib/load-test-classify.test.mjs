import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  classify,
  containerChange,
  factsFromDir,
  generatorIdleMin,
} from '../load-test/classify.mjs'

const summary = (o = {}) => ({
  metrics: {
    'iterations{scenario:site}': { values: { count: o.site ?? 1200 } },
    'iterations{scenario:admin}': { values: { count: 24 } },
    http_reqs: { values: { count: o.requests ?? 3700 } },
    'http_req_failed{scenario:site}': { values: { rate: o.failed ?? 0 } },
    dropped_iterations: { values: { count: o.dropped ?? 0 } },
  },
})
const VMSTAT =
  'procs ---memory--- \n r b swpd free id wa\n 1 0 0 900 99 0\n 2 0 0 800 55 0\n 3 0 0 700 40 0\n'
const CONTAINERS = 'amcore-loadtest-x-api-1 0 false\namcore-loadtest-x-web-1 0 false\n'
const healthy = (o = {}) => ({
  dir: {
    'k6.exit': '0',
    'summary.json': JSON.stringify(summary(o)),
    'window.json': JSON.stringify({ start: 1000, end: 1120, rate: 10 }),
    'server.json': JSON.stringify({
      requests: o.serverRequests ?? 3690,
      status: { 200: 3690 },
      all: { p95: o.p95 ?? 35 },
    }),
    'sampler.exit': '0',
    'samples.txt': '1000 host avail=400\n1005 host avail=380\n1005 ctr api 1MiB 3%\n',
    'generator-vmstat.txt': VMSTAT,
    'containers.before': CONTAINERS,
    'containers.after': CONTAINERS,
    ...o.files,
  },
})
const run = (o) => {
  const d = mkdtempSync(join(tmpdir(), 'lt-classify-'))
  for (const [name, body] of Object.entries(healthy(o).dir))
    if (body !== undefined) writeFileSync(join(d, name), body)
  return classify(factsFromDir(d))
}

test('a complete healthy step is valid with the achieved rate from the same window', () => {
  const r = run()
  assert.equal(r.class, 'valid')
  assert.equal(r.figures.achievedRate, 10)
  assert.equal(r.figures.adminAchievedRate, 0.2)
  assert.equal(r.figures.memAvailableMinMiB, 380)
})

test('runner failure paths are invalid measurements, not valid or zero', () => {
  for (const [label, files] of [
    ['k6 non-zero', { 'k6.exit': '107' }],
    ['k6 exit missing', { 'k6.exit': undefined }],
    ['summary missing', { 'summary.json': undefined }],
    ['summary corrupt', { 'summary.json': '{"metrics":' }],
    ['window missing', { 'window.json': undefined }],
    ['sampler died', { 'sampler.exit': '1' }],
    ['sampler exit missing', { 'sampler.exit': undefined }],
    ['no samples', { 'samples.txt': '' }],
    ['server stats failed', { 'server.json': undefined, 'server.err': 'no test-entry records' }],
    ['generator not sampled', { 'generator-vmstat.txt': undefined }],
    ['generator saturated', { 'generator-vmstat.txt': VMSTAT.replace(' 40 0', ' 3 0') }],
    ['container list missing', { 'containers.after': '' }],
  ]) {
    const r = run({ files })
    assert.equal(r.class, 'invalid measurement', label)
  }
})

test('a metric missing from the summary is invalid, never counted as zero', () => {
  const s = summary()
  delete s.metrics['iterations{scenario:admin}']
  assert.equal(run({ files: { 'summary.json': JSON.stringify(s) } }).class, 'invalid measurement')
})

test('a gap between k6 and the server log beyond the allowance is invalid', () => {
  assert.equal(run({ serverRequests: 3000 }).class, 'invalid measurement')
  assert.equal(run({ serverRequests: 3640 }).class, 'valid')
})

test('server-side stop conditions with a healthy generator are observed overload', () => {
  assert.equal(run({ p95: 1500 }).class, 'observed overload')
  assert.equal(run({ failed: 0.02 }).class, 'observed overload')
  assert.equal(run({ dropped: 3 }).class, 'observed overload')
  assert.equal(run({ files: { 'samples.txt': '1000 host avail=90\n' } }).class, 'observed overload')
  const restarted = 'amcore-loadtest-x-api-1 1 false\namcore-loadtest-x-web-1 0 false\n'
  assert.equal(run({ files: { 'containers.after': restarted } }).class, 'observed overload')
})

test('invalid measurement wins over overload when data are incomplete', () => {
  assert.equal(run({ p95: 1500, files: { 'sampler.exit': '1' } }).class, 'invalid measurement')
})

test('helpers: vmstat idle skips the since-boot row; container changes count restarts and OOM', () => {
  assert.equal(generatorIdleMin(VMSTAT), 40)
  assert.equal(generatorIdleMin('no header'), undefined)
  assert.deepEqual(containerChange('a 0 false\n', 'a 2 true\n'), { restarts: 2, oomKilled: true })
})
