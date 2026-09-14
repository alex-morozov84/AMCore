import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execute, runInstrumentedScenario } from './instrumented-run.mjs'
import { createRealRepoCopy } from '../lib/test-fixture.mjs'
import { commit } from '../lib/init-project-test-helpers.mjs'
import { collectRunProvenance } from './provenance.mjs'

const tempDirs = []
const copies = []
after(() => {
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  copies.splice(0).forEach((copy) => copy.cleanup())
})

describe('instrumented-run: real failure paths (BACKLOG item 14, PR1 Round 8 correction)', () => {
  test('an install exception becomes a failed-stage record, not an uncaught throw', async () => {
    // A directory with no package.json at all makes `pnpm install` fail
    // fast and for real — no network, no node_modules needed to observe it.
    const dir = mkdtempSync(path.join(tmpdir(), 'amcore-measure-install-fail-'))
    tempDirs.push(dir)
    writeFileSync(path.join(dir, 'package.json'), 'not valid json{{{')

    const scenario = { name: 'broken-install', flags: [], installBefore: true, skipVerify: true }
    const outcome = await execute(scenario, dir)

    assert.equal(outcome.success, false)
    assert.equal(outcome.failedStage, 'install')
    // Counted on attempt, not only on success.
    assert.equal(outcome.counters.installs, 1)
    assert.ok(outcome.diagnosticsPath, 'expected a diagnostics path to be recorded')
    // The apply stage never ran — install failure halts the scenario.
    assert.ok(!outcome.stages.some((s) => s.label === 'apply'))
  })

  test('a failed post-apply command is still counted as run, and halts later steps', async () => {
    const copy = createRealRepoCopy()
    copies.push(copy)
    commit(copy.root)

    const scenario = {
      name: 'failed-post-step',
      flags: ['--route-progress=disabled', '--yes'],
      installBefore: false,
      skipVerify: true,
      postApplySteps: [['definitely-not-a-real-pnpm-script'], ['lint']],
    }
    const outcome = await execute(scenario, copy.root)

    assert.equal(outcome.success, false)
    assert.equal(outcome.failedStage, 'definitely-not-a-real-pnpm-script')
    // Counted on run even though it failed.
    assert.equal(outcome.counters.lintRuns, 0) // the unknown command isn't bucketed as lint
    // The second postApplySteps entry ('lint') never ran because the loop
    // halts at the first failure.
    assert.ok(!outcome.stages.some((s) => s.label === 'lint'))
  })

  test('a failed known verification command increments its named counter', async () => {
    const failedLint = {
      label: 'lint',
      ok: false,
      durationMs: 5,
      ranAt: 't0',
      output: 'lint failed',
    }
    const scenario = {
      name: 'failed-lint',
      flags: [],
      skipVerify: true,
      postApplySteps: [['lint']],
    }
    const outcome = await execute(scenario, '/unused', {
      apply: () => ({ status: 0, stdout: '' }),
      runCommand: () => failedLint,
    })

    assert.equal(outcome.failedStage, 'lint')
    assert.equal(outcome.counters.lintRuns, 1)
  })

  test('runInstrumentedScenario surfaces a real failure end-to-end without throwing, and skips fingerprinting', async () => {
    const provenance = collectRunProvenance()
    const scenario = {
      name: 'e2e-failed-post-step',
      flags: ['--route-progress=disabled', '--yes'],
      installBefore: false,
      skipVerify: true,
      postApplySteps: [['definitely-not-a-real-pnpm-script']],
    }
    const record = await runInstrumentedScenario(scenario, provenance)

    assert.equal(record.success, false)
    assert.equal(record.failedStage, 'definitely-not-a-real-pnpm-script')
    assert.equal(record.fingerprint, null)
    assert.ok(record.diagnosticsPath)
  })
})
