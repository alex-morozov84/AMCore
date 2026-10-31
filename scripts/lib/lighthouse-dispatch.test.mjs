import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createCommittedCopy } from './init-project-test-helpers.mjs'

function sourceOnly(t) {
  const copies = []
  const root = createCommittedCopy(copies)
  t.after(() => copies.forEach((copy) => copy.cleanup()))
  assert.equal(existsSync(join(root, 'node_modules')), false)
  const require = createRequire(join(root, 'scripts/e2e-ci.mjs'))
  for (const dependency of ['yaml', 'lighthouse'])
    assert.throws(() => require.resolve(dependency), { code: 'MODULE_NOT_FOUND' })
  return root
}
function dispatch(root, argument, extra = {}) {
  return spawnSync(process.execPath, ['scripts/e2e-ci.mjs', argument], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra },
    encoding: 'utf8',
    timeout: 5000,
  })
}

test('both fresh CI planner modes run with source only and no installed packages', (t) => {
  const root = sourceOnly(t)
  const matrix = dispatch(root, '--matrix')
  const plan = dispatch(root, '--audit-plan')
  for (const result of [matrix, plan]) {
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
  }
  const lanes = JSON.parse(matrix.stdout).include
  const assignments = JSON.parse(plan.stdout).assignments
  assert.deepEqual(
    lanes.map((row) => row.lane),
    Object.keys(assignments)
  )
  assert.ok(assignments['path-standard'].includes('login'))
  assert.equal(existsSync(join(root, '.amcore')), false)
})

function fakeRuntime(root) {
  const configPath = join(root, 'packages/shared/src/config/product-admin.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  writeFileSync(configPath, JSON.stringify({ ...config, mode: 'host' }))
  const files = {
    'scripts/stand/cancellation.mjs': `export async function cancellation() {
      return {standId:'fake-lane',signal:new AbortController().signal,
        interrupted:false,finish:async()=>{}};
    }`,
    'scripts/stand/state.mjs': `export const lease=async()=>({release:async()=>{}});
      export const load=async()=>({});`,
    'scripts/stand/wait-closeout.mjs': 'export const waitForRunnerCloseout=async()=>{};',
    'scripts/stand/process.mjs': `import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
      import {phaseDeadline} from '../lib/lighthouse-deadlines.mjs';
      export const cleanEnvironment=extra=>extra;
      export const stopChildren=async()=>{};
      export async function run(_command,args,{env}) {
        if(args[0]!=='scripts/stand.mjs') throw Error('Unexpected runner');
        if(env.AMCORE_AUDIT_OWNER) {
          const epoch=Number(env.AMCORE_AUDIT_EPOCH), began=Date.now();
          appendFileSync('clock-proof.jsonl',JSON.stringify({lane:env.AMCORE_AUDIT_OWNER,epoch,began})+'\\n');
          phaseDeadline(epoch,began);
        }
        mkdirSync('.amcore/stands/fake-lane',{recursive:true});
        writeFileSync('.amcore/stands/fake-lane/manifest.json',JSON.stringify({testOutcome:'passed',state:'purged'}));
        globalThis.testLaneClock+=25*60_000;
      }`,
    'clock.mjs': `globalThis.testLaneClock=Number(process.env.TEST_LANE_CLOCK);
      Date.now=()=>globalThis.testLaneClock;`,
    'bin/pnpm': `#!${process.execPath}\nprocess.exit(0)\n`,
  }
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, source, { mode: 0o700 })
  }
}
function clockDispatch(root, argument, clock, hostedEpoch) {
  rmSync(join(root, 'clock-proof.jsonl'), { force: true })
  const result = dispatch(root, argument, {
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    NODE_OPTIONS: `--import=${join(root, 'clock.mjs')}`,
    TEST_LANE_CLOCK: String(clock),
    ...(hostedEpoch === undefined ? {} : { AMCORE_CI_EPOCH: String(hostedEpoch) }),
  })
  const rows = readFileSync(join(root, 'clock-proof.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
  return { result, rows }
}

test('sequential local owners get independent clocks while hosted setup time cannot be reset', (t) => {
  const root = sourceOnly(t)
  fakeRuntime(root)
  const epoch = 1_793_400_000_000
  const local = clockDispatch(root, '--all', epoch)
  assert.equal(local.result.status, 0, local.result.stderr)
  assert.ok(local.rows.length >= 2)
  assert.ok(local.rows[1].began - local.rows[0].began > 20 * 60_000)
  for (const row of local.rows) assert.equal(row.epoch, row.began)
  const hosted = clockDispatch(root, 'path-standard', epoch + 5 * 60_000, epoch)
  assert.equal(hosted.result.status, 0, hosted.result.stderr)
  assert.equal(hosted.rows[0].epoch, epoch)
  assert.equal(hosted.rows[0].began, epoch + 5 * 60_000)
  const expired = clockDispatch(root, 'path-standard', epoch + 25 * 60_000, epoch)
  assert.equal(expired.result.status, 1)
  assert.equal(expired.rows[0].epoch, epoch)
  assert.match(expired.result.stderr, /pre-audit-deadline-exhausted/)
})
