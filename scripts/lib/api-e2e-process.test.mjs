import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supervise, readRows } from '../api-e2e/process.mjs'
import { api, root, jest } from '../api-e2e/paths.mjs'
import { validateAttempt } from '../api-e2e/validate.mjs'
test('real child partial crash and green terminal before hanging exit remain failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-e2e-process-'))
  const progress = join(directory, 'progress.jsonl')
  const options = {
    progress,
    cwd: directory,
    env: { ...process.env, PROGRESS: progress },
    wallMilliseconds: 500,
    exitMilliseconds: 50,
    termMilliseconds: 30,
    killMilliseconds: 20,
    pollMilliseconds: 10,
  }
  try {
    const crashed = await supervise(process.execPath, ['-e', 'process.exit(7)'], options)
    assert.equal(crashed.exit, 7)
    assert.equal(crashed.spawns, 1)
    const hanging = await supervise(
      process.execPath,
      [
        '-e',
        `require('node:fs').writeFileSync(process.env.PROGRESS, JSON.stringify({event:'terminal',success:true})+String.fromCharCode(10)); process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},100)`,
      ],
      options
    )
    assert.equal(hanging.forced, true)
    assert.equal(hanging.exit, 0)
    assert.equal(hanging.spawns, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('real Jest reporter preserves late PASS retry metadata and computes success after counters', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'api-e2e-reporter-')))
  const progress = join(directory, 'progress.jsonl')
  const final = join(directory, 'final.json')
  const path = join(directory, 'retry.test.cjs')
  writeFileSync(path, `jest.retryTimes(1); let n = 0; test('late pass',()=>{expect(++n).toBe(2)})`)
  try {
    const result = await supervise(
      process.execPath,
      [
        jest,
        '--runInBand',
        '--ci',
        '--config',
        JSON.stringify({ rootDir: directory, testEnvironment: 'node', transform: {} }),
        '--reporters',
        join(root, 'scripts/api-e2e/reporter.cjs'),
        '--runTestsByPath',
        path,
      ],
      {
        cwd: api,
        progress,
        env: {
          ...process.env,
          AMCORE_E2E_PROGRESS: progress,
          AMCORE_E2E_FINAL: final,
          AMCORE_E2E_ATTEMPT: 'retry',
        },
        wallMilliseconds: 5000,
      }
    )
    const attempt = {
      ...result,
      id: 'retry',
      absolutePath: path,
      clean: true,
      rows: readRows(progress),
      final: JSON.parse(readFileSync(final)),
    }
    assert.equal(result.exit, 0)
    assert.equal(attempt.final.success, true)
    assert.equal(attempt.rows.find((row) => row.event === 'suite-end').assertions[0].invocations, 2)
    assert.throws(() => validateAttempt(attempt), /retried/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('cleanup deadline is enforced outside a hanging child and latched before exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-e2e-cleanup-process-'))
  const progress = join(directory, 'progress.jsonl')
  const states = []
  try {
    const result = await supervise(
      process.execPath,
      [
        '-e',
        `require('node:fs').writeFileSync(process.env.PROGRESS, JSON.stringify({event:'cleanup-start'})+String.fromCharCode(10)); setInterval(()=>{},100)`,
      ],
      {
        cwd: directory,
        progress,
        env: { ...process.env, PROGRESS: progress },
        cleanupMilliseconds: 30,
        wallMilliseconds: 5000,
        termMilliseconds: 30,
        killMilliseconds: 20,
        pollMilliseconds: 10,
        onState: (state) => states.push({ ...state }),
      }
    )
    assert.equal(result.forced, true)
    assert.ok(states.some((state) => state.forced && !state.closed))
    assert.equal(result.spawns, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
