// Shell-level tests of run-step.sh, sampler.sh and protocol.sh with stub docker/ssh/vmstat
// (scripts/lib/load-test-stubs.mjs). They prove the runner's own failure paths produce
// "invalid measurement", not only the classifier's handling of ready-made files.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { ROOT, stubWorld } from './load-test-stubs.mjs'

const ROUTES = [
  '/api/auth/me',
  '/api/product-access/organizations',
  '/api/product-access/organizations/o1/context',
  '/en/settings/sessions',
  '/api/product-access/organizations/o1/members',
  '/en/login',
  '/api/notifications/unread-count',
  '/api/auth/me/avatar',
  '/api/v1/admin/users',
  '/api/v1/admin/audit-logs',
].join(',')

const sh = (world, script, args, extra) =>
  spawnSync('sh', [join(ROOT, 'scripts/load-test', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: world.env(extra),
  })
const result = (world, out, step) =>
  JSON.parse(readFileSync(join(world.work, out, 'steps', step, 'result.json'), 'utf8'))

test('a complete step with every source healthy is valid', () => {
  const world = stubWorld()
  world.stub({ routes: ROUTES })
  const r = sh(world, 'run-step.sh', ['r5-1', '5', '3'])
  assert.equal(r.status, 0, r.stderr)
  const res = result(world, 'out', 'r5-1')
  assert.equal(res.class, 'valid', JSON.stringify(res.reasons))
  assert.equal(res.figures.requests, 10)
  assert.equal(res.figures.serverRequests, 10)
})

test('k6 failing makes the step invalid', () => {
  const world = stubWorld()
  world.stub({ routes: ROUTES, k6: 'fail' })
  sh(world, 'run-step.sh', ['r5-1', '5', '3'])
  const res = result(world, 'out', 'r5-1')
  assert.equal(res.class, 'invalid measurement')
  assert.match(res.reasons.join(';'), /k6 exited with 107/)
})

test('a failing sampler source makes the step invalid', () => {
  const world = stubWorld()
  world.stub({ routes: ROUTES, stats: 'fail' })
  sh(world, 'run-step.sh', ['r5-1', '5', '3'])
  const res = result(world, 'out', 'r5-1')
  assert.equal(res.class, 'invalid measurement')
  assert.match(res.reasons.join(';'), /host sampler failed/)
})

test('a hung sampler source fails the sampler stop although the process is alive', () => {
  const world = stubWorld()
  world.stub({ stats: 'hang' })
  const dir = join(world.dir, 'sampler')
  assert.equal(sh(world, 'sampler.sh', ['start', dir]).status, 0)
  spawnSync('sleep', ['10']) // past the 8-interval limit (interval 1 s in tests)
  const stop = sh(world, 'sampler.sh', ['stop', dir])
  assert.notEqual(stop.status, 0)
  assert.equal(readFileSync(join(dir, 'sampler.exit'), 'utf8').trim(), '1')
})

test('smoke then campaign: separate outputs, and an invalid warm-up stops before the ladder', () => {
  const world = stubWorld()
  world.stub({ routes: ROUTES })
  const smoke = sh(world, 'protocol.sh', ['smoke'])
  assert.equal(smoke.status, 0, smoke.stderr)
  world.stub({ routes: ROUTES, k6: 'fail' })
  const campaign = sh(world, 'protocol.sh', ['campaign'])
  assert.equal(campaign.status, 0, campaign.stderr)
  assert.match(campaign.stdout, /the warm-up is invalid measurement, so no step was measured/)
  assert.deepEqual(readdirSync(join(world.work, 'out', 'steps')), ['warmup'])
  assert.ok(existsSync(join(world.work, 'out', 'report.md')))
  const smokeReport = readFileSync(join(world.work, 'out-smoke', 'report.md'), 'utf8')
  assert.match(smokeReport, /\| smoke-\d+ \| valid \|/)
  const manifest = JSON.parse(readFileSync(join(world.work, 'out', 'manifest.json'), 'utf8'))
  assert.equal(manifest.sameHarness, true)
  assert.equal(manifest.referenceProtocol, true)
})

const clockOf = (world) =>
  JSON.parse(readFileSync(join(world.work, 'out/steps/r5-1/clock.json'), 'utf8'))

test('clock: slow SSH setup is no skew; a small real offset is measured with its bound', () => {
  // Fresh host: 1.2 s of SSH setup on a busy host was once reported as skew.
  const slow = stubWorld()
  slow.stub({ routes: ROUTES })
  const r = sh(slow, 'run-step.sh', ['r5-1', '5', '3'], { STUB_SSH_DELAY: '1.5' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(Math.abs(clockOf(slow).skewS) < 0.1, `skew ${clockOf(slow).skewS}`)
  assert.equal(result(slow, 'out', 'r5-1').class, 'valid')
  const ahead = stubWorld()
  ahead.stub({ routes: ROUTES })
  assert.equal(
    sh(ahead, 'run-step.sh', ['r5-1', '5', '3'], { STUB_CLOCK_OFFSET_MS: '300' }).status,
    0
  )
  const c = clockOf(ahead)
  assert.ok(Math.abs(c.skewS - 0.3) <= c.skewUncertaintyS + 0.05, JSON.stringify(c))
})

test('clock: an offset above 1 s is refused, also when the answer is held (FH2-2)', () => {
  for (const [label, env] of [
    ['host 1.6 s ahead', { STUB_CLOCK_OFFSET_MS: '1600' }],
    ['host 1.6 s behind', { STUB_CLOCK_OFFSET_MS: '-1600' }],
    // Agent 2 probe: +1.6 s with the reply held 1.6 s after the timestamp was read.
    ['ahead and held', { STUB_CLOCK_OFFSET_MS: '1600', STUB_CLOCK_HOLD_MS: '1600' }],
  ]) {
    const world = stubWorld()
    world.stub({ routes: ROUTES })
    const r = sh(world, 'run-step.sh', ['r5-1', '5', '3'], env)
    assert.notEqual(r.status, 0, label)
    assert.match(r.stderr, /not provably within 1 s/, label)
  }
})

test('a failing log source or a broken archive makes the step invalid (FH2-1)', () => {
  for (const [mode, reason] of [
    ['fail-after-tar', /fetching the host access logs failed/],
    ['truncated', /archive is incomplete or corrupt/],
  ]) {
    const world = stubWorld()
    world.stub({ routes: ROUTES, logs: mode })
    sh(world, 'run-step.sh', ['r5-1', '5', '3'])
    const res = result(world, 'out', 'r5-1')
    assert.equal(res.class, 'invalid measurement', mode)
    assert.match(res.reasons.join(';'), reason, mode)
  }
})
