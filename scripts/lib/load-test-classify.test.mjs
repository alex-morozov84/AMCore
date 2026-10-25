import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  classify,
  REQUIRED_ROUTES,
  reconcileAllowance,
  SMOKE_CHECKS,
} from '../load-test/classify.mjs'
import { containerChange, factsFromDir } from '../load-test/step-facts.mjs'

const W = { start: 1000, end: 1120 }
const metrics = (o = {}) => ({
  'iterations{scenario:site}': { values: { count: o.site ?? 1200 } },
  'iterations{scenario:admin}': { values: { count: 24 } },
  'http_reqs{scenario:site}': { values: { count: o.siteReqs ?? 3652 } },
  'http_reqs{scenario:admin}': { values: { count: o.adminReqs ?? 48 } },
  // Includes the setup sign-in, which the window excludes.
  http_reqs: { values: { count: (o.siteReqs ?? 3652) + (o.adminReqs ?? 48) + 1 } },
  'http_req_failed{scenario:site}': { values: { rate: o.siteFailed ?? 0 } },
  'http_req_failed{scenario:admin}': { values: { rate: o.adminFailed ?? 0 } },
  dropped_iterations: { values: { count: o.dropped ?? 0 } },
  vus_max: { values: { value: 20 } },
})
const every = (step, from = W.start - 3, to = W.end + 3) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)
const CONTAINERS = 'amcore-api-1 aaa 0 false\namcore-web-1 bbb 0 false\n'
const routes = Object.fromEntries(
  REQUIRED_ROUTES.map((r) => [r.startsWith('/api') ? r : `/:locale${r}`, { n: 1 }])
)
function files(o = {}) {
  return {
    'k6.exit': '0',
    'summary.json': JSON.stringify({ metrics: metrics(o), root_group: { checks: o.checks ?? [] } }),
    'window.json': JSON.stringify({ ...W, rate: 10, smoke: Boolean(o.smoke) }),
    'clock.json': JSON.stringify({ skewS: 0.02 }),
    'server.json': JSON.stringify({
      requests: o.serverRequests ?? 3700,
      status: { 200: 3700 },
      all: { p95: o.p95 ?? 35 },
      routes: o.routes ?? routes,
    }),
    'sampler.exit': '0',
    'samples.txt': (o.hostTimes ?? every(5))
      .map((t) => `${t} host avail=${o.avail ?? 400}`)
      .join('\n'),
    'generator.txt': (o.genTimes ?? every(5)).map((t) => `${t} idle=${o.idle ?? 60}`).join('\n'),
    'containers.before': CONTAINERS,
    'containers.after': o.after ?? CONTAINERS,
    ...o.files,
  }
}
function run(o) {
  const d = mkdtempSync(join(tmpdir(), 'lt-classify-'))
  for (const [name, body] of Object.entries(files(o)))
    if (body !== undefined) writeFileSync(join(d, name), body)
  return classify(factsFromDir(d))
}

test('a complete healthy step is valid; rates and counts come from the measured window', () => {
  const r = run()
  assert.equal(r.class, 'valid', r.reasons.join('; '))
  assert.equal(r.figures.achievedRate, 10)
  assert.equal(r.figures.adminAchievedRate, 0.2)
  assert.equal(r.figures.requests, 3700, 'setup sign-in excluded')
})

test('runner failure paths are invalid measurements, never valid or zero', () => {
  for (const [label, o] of [
    ['k6 non-zero', { files: { 'k6.exit': '107' } }],
    ['k6 exit missing', { files: { 'k6.exit': undefined } }],
    ['summary corrupt', { files: { 'summary.json': '{"metrics":' } }],
    ['window missing', { files: { 'window.json': undefined } }],
    ['skew missing', { files: { 'clock.json': undefined } }],
    ['sampler failed', { files: { 'sampler.exit': '1' } }],
    ['server stats failed', { files: { 'server.json': undefined, 'server.err': 'no records' } }],
    ['generator not sampled', { genTimes: [] }],
    ['generator saturated', { idle: 3 }],
    ['container list missing', { after: '' }],
  ]) {
    assert.equal(run(o).class, 'invalid measurement', label)
  }
  assert.match(
    run({ files: { 'k6.exit': '107', 'window.json': undefined } }).reasons.join(';'),
    /k6 exited with 107/
  )
})

test('incomplete samples are invalid even when the sampler exited 0', () => {
  // Agent 2 reproduction: window 1000–1120, one host sample at 1000.
  assert.match(
    run({ hostTimes: [1000] }).reasons.join(';'),
    /host samples stop before the window ends/
  )
  assert.match(
    run({ hostTimes: [1000, 1010, 1080, 1120] }).reasons.join(';'),
    /host samples have a 70 s gap/
  )
  assert.match(run({ genTimes: [1030, 1120] }).reasons.join(';'), /generator samples start late/)
})

test('admin-only and check-only failures are not hidden', () => {
  // Agent 2 reproduction: 48 admin responses failed, site healthy, p95 30 ms.
  const admin = run({ adminFailed: 1, p95: 30 })
  assert.equal(admin.class, 'observed overload')
  assert.match(admin.reasons.join(';'), /failed admin requests 100.00 %/)
  assert.ok(admin.figures.failedRate > 0.01)
  const checks = SMOKE_CHECKS.map((name) => ({
    name,
    passes: 3,
    fails: name === 'bff_avatar' ? 1 : 0,
  }))
  const smoke = run({ smoke: true, checks })
  assert.equal(smoke.class, 'invalid measurement')
  assert.match(smoke.reasons.join(';'), /smoke checks failed: bff_avatar/)
  assert.deepEqual(smoke.figures.checkFails, { bff_avatar: 1 })
  const partial = run({ smoke: true, checks: [{ name: 'bff_me', passes: 1, fails: 0 }] })
  assert.match(partial.reasons.join(';'), /smoke did not run bff_orgs/)
})

test('a missing required metric or route class is invalid', () => {
  const s = { metrics: metrics() }
  delete s.metrics['http_reqs{scenario:admin}']
  assert.match(
    run({ files: { 'summary.json': JSON.stringify(s) } }).reasons.join(';'),
    /lacks a required metric/
  )
  // Agent 2 C4b: iteration counters are required too, and a broken value is not a number.
  for (const [label, change] of [
    ['site iterations missing', (m) => delete m['iterations{scenario:site}']],
    ['admin iterations missing', (m) => delete m['iterations{scenario:admin}']],
    ['site iterations corrupt', (m) => (m['iterations{scenario:site}'].values.count = 'x')],
    [
      'admin failure rate corrupt',
      (m) => (m['http_req_failed{scenario:admin}'].values.rate = null),
    ],
  ]) {
    const broken = { metrics: metrics() }
    change(broken.metrics)
    const r = run({ files: { 'summary.json': JSON.stringify(broken) } })
    assert.equal(r.class, 'invalid measurement', label)
    assert.match(r.reasons.join(';'), /lacks a required metric/, label)
  }
  const { '/api/auth/me/avatar': _gone, ...withoutUpload } = routes
  assert.match(
    run({ routes: withoutUpload }).reasons.join(';'),
    /no server records for \/api\/auth\/me\/avatar/
  )
})

test('reconciliation allows in-flight requests and measured skew only', () => {
  const allowed = reconcileAllowance(20, 3700 / 120, 0.02)
  assert.equal(allowed, 20 + Math.ceil((3700 / 120) * 2 * 0.12))
  assert.equal(run({ serverRequests: 3700 - allowed }).class, 'valid')
  assert.equal(run({ serverRequests: 3700 - allowed - 1 }).class, 'invalid measurement')
})

test('server-side stop conditions with a healthy generator are observed overload', () => {
  assert.equal(run({ p95: 1500 }).class, 'observed overload')
  assert.equal(run({ siteFailed: 0.02 }).class, 'observed overload')
  assert.equal(run({ dropped: 3 }).class, 'observed overload')
  assert.equal(run({ avail: 90 }).class, 'observed overload')
  assert.equal(
    run({ after: 'amcore-api-1 aaa 1 false\namcore-web-1 bbb 0 false\n' }).class,
    'observed overload'
  )
  assert.match(
    run({ after: 'amcore-api-1 zzz 0 false\namcore-web-1 bbb 0 false\n' }).reasons.join(';'),
    /recreated during the step: amcore-api-1/
  )
  assert.equal(
    run({ p95: 1500, files: { 'sampler.exit': '1' } }).class,
    'invalid measurement',
    'invalid wins'
  )
})

test('container sets are compared by name and id', () => {
  // Agent 2 reproduction: api/web before, api/other after — not a negative restart count.
  assert.equal(
    containerChange('api a 0 false\nweb b 0 false\n', 'api a 0 false\nother c 0 false\n')
      .containersMissing,
    true
  )
  assert.deepEqual(containerChange('api a 0 false\n', 'api a 2 true\n'), {
    containersMissing: false,
    restarts: 2,
    recreated: [],
    oomKilled: true,
  })
})
