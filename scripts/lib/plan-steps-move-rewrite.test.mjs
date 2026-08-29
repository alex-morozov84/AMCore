// moveAndRewriteStep — added for init:project (ADR-071, PR3B): files that
// both relocate and need a structural content edit as part of the move.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EngineError } from './actions.mjs'
import { moveAndRewriteStep } from './plan-steps.mjs'

let dir

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'amcore-move-rewrite-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('moveAndRewriteStep', () => {
  test('writes the new content at the destination and removes the source', () => {
    const oldPath = path.join(dir, 'old', 'a.ts')
    const newPath = path.join(dir, 'new', 'a.ts')
    mkdirSync(path.dirname(oldPath), { recursive: true })
    writeFileSync(oldPath, 'export const x = 1\n')

    const step = moveAndRewriteStep(
      oldPath,
      newPath,
      { expectedBefore: 'export const x = 1\n', after: 'export const x = 2\n' },
      'move and bump x'
    )
    assert.equal(step.changed, true)
    assert.equal(existsSync(oldPath), true, 'source untouched before write()')

    step.write()
    assert.equal(existsSync(oldPath), false)
    assert.equal(readFileSync(newPath, 'utf8'), 'export const x = 2\n')
  })

  test('fails closed when the source has drifted from the expected content', () => {
    const oldPath = path.join(dir, 'a.ts')
    writeFileSync(oldPath, 'export const x = 999\n')

    assert.throws(
      () =>
        moveAndRewriteStep(
          oldPath,
          path.join(dir, 'b.ts'),
          { expectedBefore: 'export const x = 1\n', after: 'export const x = 2\n' },
          'move and bump x'
        ),
      EngineError
    )
  })

  test('supports rewriting in place when oldPath === newPath (no move, content only)', () => {
    const filePath = path.join(dir, 'a.ts')
    writeFileSync(filePath, 'export const x = 1\n')

    moveAndRewriteStep(
      filePath,
      filePath,
      { expectedBefore: 'export const x = 1\n', after: 'export const x = 2\n' },
      'bump x'
    ).write()

    assert.equal(readFileSync(filePath, 'utf8'), 'export const x = 2\n')
  })
})
