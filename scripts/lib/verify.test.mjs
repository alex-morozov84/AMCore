// Deliberately NOT run against a disposable fixture: `pnpm typecheck`/
// `pnpm lint` only mean something inside a real pnpm/turbo workspace, and a
// minimal fixture tree isn't one (see init-brand.test.mjs, which stubs
// verify() for exactly that reason). This is the one test proving the real
// command wiring actually works, against the one workspace where it can.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runVerification } from './verify.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('runVerification (real pnpm commands against the actual repo)', () => {
  test('reports typecheck and lint as OK against a clean checkout', () => {
    const results = runVerification(REPO_ROOT)

    const byLabel = Object.fromEntries(results.map((result) => [result.label, result]))
    assert.ok(byLabel.typecheck, 'expected a typecheck result')
    assert.ok(byLabel.lint, 'expected a lint result')
    assert.equal(byLabel.typecheck.ok, true, byLabel.typecheck.output)
    assert.equal(byLabel.lint.ok, true, byLabel.lint.output)
  })
})
