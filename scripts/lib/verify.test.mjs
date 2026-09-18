// Deliberately NOT run against a disposable fixture: `pnpm typecheck`/
// `pnpm lint` only mean something inside a real pnpm/turbo workspace, and a
// minimal fixture tree isn't one (see init-brand.test.mjs, which stubs
// verify() for exactly that reason). This is the one test proving the real
// command wiring actually works, against the one workspace where it can.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withRecordingPnpm } from './recording-pnpm-test-helper.mjs'
import { runVerification } from './verify.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('runVerification pnpm wiring', () => {
  test('runs typecheck and lint in order through pnpm', () => {
    withRecordingPnpm(undefined, (recording) => {
      const results = runVerification(REPO_ROOT)

      const byLabel = Object.fromEntries(results.map((result) => [result.label, result]))
      assert.ok(byLabel.typecheck, 'expected a typecheck result')
      assert.ok(byLabel.lint, 'expected a lint result')
      assert.equal(byLabel.typecheck.ok, true, byLabel.typecheck.output)
      assert.equal(byLabel.lint.ok, true, byLabel.lint.output)
      const calls = recording.readCalls()
      assert.deepEqual(
        calls.map(({ args }) => args),
        [['typecheck'], ['lint']]
      )
      assert.deepEqual(new Set(calls.map(({ cwd }) => cwd)), new Set([REPO_ROOT]))
    })
  })

  test('reports the exact failing command without invoking the real workspace', () => {
    withRecordingPnpm(['lint'], (recording) => {
      const results = runVerification(REPO_ROOT)
      assert.equal(results[0].ok, true)
      assert.equal(results[1].ok, false)
      assert.match(results[1].output, /injected pnpm failure/)
      assert.deepEqual(new Set(recording.readCalls().map(({ cwd }) => cwd)), new Set([REPO_ROOT]))
    })
  })
})
