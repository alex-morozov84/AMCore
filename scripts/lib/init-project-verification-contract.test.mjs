import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { INIT_PROJECT, commit } from './init-project-test-helpers.mjs'
import { createRecordingPnpm } from './recording-pnpm-test-helper.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

const EXPECTED_COMMANDS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'build'],
  ['--filter', 'api', 'test'],
  ['--filter', 'web', 'test'],
]

let copy
let fake

afterEach(() => {
  copy?.cleanup()
  fake?.cleanup()
  copy = undefined
  fake = undefined
})

function runProject(root, recording, failCommand) {
  const env = recording.environment(failCommand)
  delete env.AMCORE_INIT_SKIP_VERIFY
  delete env.AMCORE_INIT_FAKE_VERIFY_FAIL
  Object.assign(env, {
    NODE_ENV: 'test',
    AMCORE_INIT_ROOT: root,
  })
  return spawnSync(process.execPath, [INIT_PROJECT, '--route-progress=disabled', '--yes'], {
    encoding: 'utf8',
    env,
  })
}

function assertCalls(recording, root) {
  const calls = recording.readCalls()
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
    fake = createRecordingPnpm()
    const result = runProject(copy.root, fake)

    assert.equal(result.status, 0, result.stdout + result.stderr)
    assertCalls(fake, copy.root)
    assert.match(result.stdout, /web test: OK/)
  })

  test('reports a pnpm failure and exits non-zero', () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    fake = createRecordingPnpm()
    const result = runProject(copy.root, fake, ['--filter', 'api', 'test'])

    assert.equal(result.status, 1, result.stdout + result.stderr)
    assertCalls(fake, copy.root)
    assert.match(result.stdout, /api test: FAILED/)
    assert.match(result.stdout, /injected pnpm failure/)
    assert.match(result.stdout, /Verification failed/)
  })
})
