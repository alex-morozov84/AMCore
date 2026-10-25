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

test('a slow SSH connection setup is not reported as clock skew', () => {
  // Fresh host: the middle-of-round-trip estimate turned 1.2 s of SSH setup on a busy host
  // into "clock skew" and refused the control step.
  const world = stubWorld()
  world.stub({ routes: ROUTES })
  const r = sh(world, 'run-step.sh', ['r5-1', '5', '3'], { STUB_SSH_DELAY: '1.5' })
  assert.equal(r.status, 0, r.stderr)
  const clock = JSON.parse(readFileSync(join(world.work, 'out/steps/r5-1/clock.json'), 'utf8'))
  assert.ok(Math.abs(clock.skewS) < 0.3, `skew ${clock.skewS}`)
  assert.ok(clock.rttMs >= 1500)
  assert.equal(result(world, 'out', 'r5-1').class, 'valid')
})
