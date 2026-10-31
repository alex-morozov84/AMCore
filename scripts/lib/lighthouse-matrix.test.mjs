import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

test('matrix works without Git or dependencies while evidence modes still require checkout identity', (t) => {
  const copy = createWorkingTreeCopy()
  t.after(() => copy.cleanup())
  assert.equal(existsSync(join(copy.root, '.git')), false)
  assert.equal(existsSync(join(copy.root, 'node_modules')), false)
  const env = {
    PATH: join(copy.root, 'no-tools'),
    HOME: process.env.HOME,
    GITHUB_OUTPUT: join(copy.root, 'outputs'),
    GITHUB_STEP_SUMMARY: join(copy.root, 'summary'),
  }
  const dispatch = (argument) =>
    spawnSync(process.execPath, ['scripts/e2e-ci.mjs', argument], {
      cwd: copy.root,
      env,
      encoding: 'utf8',
      timeout: 5000,
    })
  const matrix = dispatch('--matrix')
  assert.equal(matrix.status, 0, matrix.stderr)
  const rows = JSON.parse(matrix.stdout).include
  assert.ok(rows.length > 0)
  assert.equal(rows.find((row) => row.lane === 'path-standard').timeout, 40)
  assert.equal(rows.find((row) => row.lane === 'mocked').timeout, 20)
  assert.equal(new Set(rows.map((row) => row.lane)).size, rows.length)
  for (const argument of ['--audit-plan', '--plan-ci']) {
    const refused = dispatch(argument)
    assert.equal(refused.error, undefined)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /git/)
  }
  for (const path of ['outputs', 'summary', '.amcore'])
    assert.equal(existsSync(join(copy.root, path)), false)
})
