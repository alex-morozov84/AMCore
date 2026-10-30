import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
