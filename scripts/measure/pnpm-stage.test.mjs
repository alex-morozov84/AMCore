import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { saveDiagnostics, bucketFor } from './pnpm-stage.mjs'

after(() => rmSync(path.resolve('tmp/scaffolding-baseline/diagnostics'), { recursive: true, force: true }))

describe('saveDiagnostics', () => {
  test('returns a path relative to the repo root, never absolute', () => {
    const file = saveDiagnostics('demo-scenario', { label: 'typecheck', output: 'boom' })
    assert.equal(path.isAbsolute(file), false)
    assert.match(file, /^tmp[\\/]scaffolding-baseline[\\/]diagnostics[\\/]/)
  })

  test('sanitizes the stage label into a safe filename', () => {
    const file = saveDiagnostics('demo', { label: '--filter web test', output: '' })
    assert.doesNotMatch(path.basename(file), /[^\w.-]/)
  })
})

describe('bucketFor', () => {
  test('maps typecheck/lint/build/test command shapes to their counter bucket', () => {
    assert.equal(bucketFor(['typecheck']), 'typecheckRuns')
    assert.equal(bucketFor(['lint']), 'lintRuns')
    assert.equal(bucketFor(['--filter', 'web', 'build']), 'buildRuns')
    assert.equal(bucketFor(['--filter', 'web', 'test']), 'testRuns')
  })

  test('returns null for an unrecognized command shape rather than guessing', () => {
    assert.equal(bucketFor(['install']), null)
  })
})
