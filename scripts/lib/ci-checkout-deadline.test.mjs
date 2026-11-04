import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'

test('checkout post action survives expired admission; the separate admission gate still refuses lateness', () => {
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  )
  const steps = workflow.jobs['web-e2e'].steps
  const checkout = steps.find((step) => step.name === 'Checkout exact evidence policy')
  const gate = steps.find((step) => step.name === 'Require checkout within admission phase')
  assert.equal(checkout['timeout-minutes'], 1)
  assert.equal(checkout.env?.NODE_OPTIONS, undefined)
  assert.equal(checkout.with['persist-credentials'], false)
  assert.equal(steps.indexOf(gate), steps.indexOf(checkout) + 1)
  assert.match(gate.run, /node --import.*amcore-action-deadline/)
  const directory = mkdtempSync(join(tmpdir(), 'checkout-post-deadline-'))
  try {
    const source = steps.find((step) => step.name === 'Record aggregate phase deadlines').run
    const preload = join(directory, 'deadline.mjs')
    writeFileSync(preload, source.split("<<'JS'\n")[1].split('\nJS')[0])
    const env = { PATH: process.env.PATH, AMCORE_ACTION_DEADLINE: String(Date.now() - 1000) }
    const old = spawnSync(process.execPath, ['-e', 'console.log("post-ran")'], {
      env: { ...env, NODE_OPTIONS: `--import=${preload}` },
      encoding: 'utf8',
    })
    assert.equal(old.status, 1) // Original #626 defect: post never reaches checkout cleanup.
    assert.doesNotMatch(old.stdout, /post-ran/)
    const post = spawnSync(process.execPath, ['-e', 'console.log("post-ran")'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(post.status, 0)
    assert.match(post.stdout, /post-ran/)
    const admit = (deadline) =>
      spawnSync(process.execPath, ['--import', preload, '-e', ''], {
        env: { ...env, AMCORE_ACTION_DEADLINE: String(deadline) },
        encoding: 'utf8',
      }).status
    assert.equal(admit(Date.now() - 1000), 1)
    assert.equal(admit(Date.now() + 10_000), 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
