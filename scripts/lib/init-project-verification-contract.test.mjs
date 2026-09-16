import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { INIT_PROJECT, commit } from './init-project-test-helpers.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

const EXPECTED_COMMANDS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'build'],
  ['--filter', 'api', 'test'],
  ['--filter', 'web', 'test'],
]

let copy
let fakeBin

afterEach(() => {
  copy?.cleanup()
  if (fakeBin) rmSync(fakeBin, { recursive: true, force: true })
  copy = undefined
  fakeBin = undefined
})

function createFakePnpm() {
  fakeBin = mkdtempSync(path.join(tmpdir(), 'amcore-fake-pnpm-'))
  const executable = path.join(fakeBin, 'pnpm')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.AMCORE_VERIFY_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\\n')
if (JSON.stringify(args) === process.env.AMCORE_VERIFY_FAIL) {
  console.error('injected pnpm failure')
  process.exitCode = 17
}
`,
    { mode: 0o755 }
  )
  return { bin: fakeBin, log: path.join(fakeBin, 'calls.jsonl') }
}

function runProject(root, fake, failCommand) {
  const env = { ...process.env }
  delete env.AMCORE_INIT_SKIP_VERIFY
  delete env.AMCORE_INIT_FAKE_VERIFY_FAIL
  Object.assign(env, {
    NODE_ENV: 'test',
    AMCORE_INIT_ROOT: root,
    AMCORE_VERIFY_LOG: fake.log,
    PATH: `${fake.bin}${path.delimiter}${env.PATH}`,
    ...(failCommand ? { AMCORE_VERIFY_FAIL: JSON.stringify(failCommand) } : {}),
  })
  return spawnSync(process.execPath, [INIT_PROJECT, '--route-progress=disabled', '--yes'], {
    encoding: 'utf8',
    env,
  })
}

function readCalls(log) {
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

function assertCalls(log, root) {
  const calls = readCalls(log)
  assert.deepEqual(
    calls.map(({ args }) => args),
    EXPECTED_COMMANDS
  )
  assert.deepEqual(new Set(calls.map(({ cwd }) => cwd)), new Set([realpathSync(root)]))
}

describe('init:project production verification wiring', () => {
  test('runs all five project verification commands through pnpm', () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    const fake = createFakePnpm()
    const result = runProject(copy.root, fake)

    assert.equal(result.status, 0, result.stdout + result.stderr)
    assertCalls(fake.log, copy.root)
    assert.match(result.stdout, /web test: OK/)
  })

  test('reports a pnpm failure and exits non-zero', () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    const fake = createFakePnpm()
    const result = runProject(copy.root, fake, ['--filter', 'api', 'test'])

    assert.equal(result.status, 1, result.stdout + result.stderr)
    assertCalls(fake.log, copy.root)
    assert.match(result.stdout, /api test: FAILED/)
    assert.match(result.stdout, /injected pnpm failure/)
    assert.match(result.stdout, /Verification failed/)
  })
})
