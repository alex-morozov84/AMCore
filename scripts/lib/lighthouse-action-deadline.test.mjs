import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const preload = fileURLToPath(new URL('../lighthouse/action-deadline.mjs', import.meta.url))
test('action deadline terminates blocked transfer code and refuses an exhausted reserve before execution', () => {
  const run = (deadline, script) =>
    spawnSync(process.execPath, ['--import', preload, '-e', script], {
      env: { ...process.env, AMCORE_ACTION_DEADLINE: String(deadline) },
      encoding: 'utf8',
      timeout: 2000,
    })
  const stuck = run(Date.now() + 100, 'setInterval(() => {}, 1000)')
  assert.equal(stuck.error, undefined)
  assert.equal(stuck.status, 1)
  assert.match(stuck.stderr, /phase deadline exhausted/)
  const exhausted = run(Date.now() - 1, 'console.log("executed")')
  assert.equal(exhausted.status, 1)
  assert.equal(exhausted.stdout, '')
  assert.equal(run(Date.now() + 1000, 'process.exit(0)').status, 0)
})

test('transfer admits the observed 19m38s non-owner completion and refuses a spent reserve', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-transfer-budget-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const epoch = 1_000_000
  const script = new URL('../lighthouse/ci-transfer-budget.mjs', import.meta.url).href
  const run = (minutes, owner, output) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `Date.now = () => ${epoch} + ${minutes} * 60_000; await import(${JSON.stringify(script)});`,
      ],
      {
        env: {
          ...process.env,
          AMCORE_CI_EPOCH: String(epoch),
          AMCORE_AUDIT_JOB_OWNER: String(owner),
          GITHUB_ENV: output,
        },
        encoding: 'utf8',
        timeout: 2000,
      }
    )
  for (const [owner, finish] of [
    [false, 19 + 38 / 60],
    [false, 22.5],
    [true, 37.5],
  ]) {
    const output = join(directory, String(finish))
    const result = run(finish, owner, output)
    assert.equal(result.status, 0, result.stderr)
    const ends = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const [key, value] = line.split('=')
          return [key, Number(value)]
        })
    )
    const now = epoch + finish * 60_000
    assert.equal(ends.AMCORE_E2E_TRANSFER_END, now + 20_000)
    assert.equal(ends.AMCORE_BUNDLE_TRANSFER_END, now + 70_000)
    assert.equal(ends.AMCORE_STATUS_TRANSFER_END, now + 90_000)
    const rejected = run(owner ? 37.5 + 1 / 60_000 : 22.5 + 1 / 60_000, owner, output)
    assert.equal(rejected.status, 1)
    assert.match(rejected.stderr, /transfer-reserve-exhausted/)
    assert.equal(readFileSync(output, 'utf8').trim().split('\n').length, 3)
  }
})
