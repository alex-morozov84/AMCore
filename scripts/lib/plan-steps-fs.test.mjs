// exactContentStep/moveFileStep/deleteFileStep — the fs-restructuring
// primitives added for init:project (ADR-071, PR3A). Split from
// plan-steps.test.mjs to stay under the repo's ~150-line-per-file guidance.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EngineError } from './actions.mjs'
import { exactContentStep, moveFileStep, deleteFileStep } from './plan-steps.mjs'

let dir

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'amcore-plan-steps-fs-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('exactContentStep', () => {
  test('replaces the whole file when the current content matches exactly', () => {
    const file = path.join(dir, 'a.ts')
    writeFileSync(file, 'export const x = 1\n')

    const step = exactContentStep(
      file,
      { expectedBefore: 'export const x = 1\n', after: 'export const x = 2\n' },
      'bump x'
    )

    assert.equal(step.changed, true)
    step.write()
    assert.equal(readFileSync(file, 'utf8'), 'export const x = 2\n')
  })

  test('fails closed when the file has drifted from the expected content', () => {
    const file = path.join(dir, 'a.ts')
    writeFileSync(file, 'export const x = 999 // someone already changed this\n')

    assert.throws(
      () =>
        exactContentStep(
          file,
          { expectedBefore: 'export const x = 1\n', after: 'export const x = 2\n' },
          'bump x'
        ),
      EngineError
    )
  })

  test('reports changed=false when expectedBefore already equals after', () => {
    const file = path.join(dir, 'a.ts')
    writeFileSync(file, 'export const x = 2\n')

    const step = exactContentStep(
      file,
      { expectedBefore: 'export const x = 2\n', after: 'export const x = 2\n' },
      'bump x'
    )
    assert.equal(step.changed, false)
    assert.match(step.summary, /already up to date/)
  })
})

describe('moveFileStep', () => {
  test('creates missing parent directories and renames the file', () => {
    const src = path.join(dir, 'src.ts')
    writeFileSync(src, 'content')
    const dest = path.join(dir, 'nested', 'dest.ts')

    const step = moveFileStep(src, dest, 'move')
    assert.equal(existsSync(src), true)
    assert.equal(existsSync(dest), false)

    step.write()
    assert.equal(existsSync(src), false)
    assert.equal(readFileSync(dest, 'utf8'), 'content')
  })
})

describe('deleteFileStep', () => {
  test('deletes a file', () => {
    const file = path.join(dir, 'a.ts')
    writeFileSync(file, 'x')

    deleteFileStep(file, 'delete').write()
    assert.equal(existsSync(file), false)
  })

  test('deletes a directory recursively', () => {
    const featureDir = path.join(dir, 'feature')
    mkdirSync(featureDir)
    writeFileSync(path.join(featureDir, 'nested.ts'), 'x')

    deleteFileStep(featureDir, 'delete').write()
    assert.equal(existsSync(featureDir), false)
  })

  test('does not throw when the target is already gone', () => {
    assert.doesNotThrow(() => deleteFileStep(path.join(dir, 'missing.ts'), 'delete').write())
  })
})
