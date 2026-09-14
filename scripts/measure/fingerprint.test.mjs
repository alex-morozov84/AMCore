import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, git } from '../lib/test-fixture.mjs'
import { fingerprintTree, groupCandidateEquivalents } from './fingerprint.mjs'

const fixtures = []
function freshFixture() {
  const fixture = createFixtureRepo()
  fixtures.push(fixture)
  return fixture
}
after(() => fixtures.forEach((f) => f.cleanup()))

describe('fingerprintTree', () => {
  test('is stable for an unchanged tree', () => {
    const fixture = freshFixture()
    assert.equal(fingerprintTree(fixture.root).treeHash, fingerprintTree(fixture.root).treeHash)
  })

  test('changes when a tracked file changes', () => {
    const fixture = freshFixture()
    const before = fingerprintTree(fixture.root).treeHash
    writeFileSync(path.join(fixture.root, 'package.json'), '{"name":"changed"}\n')
    const after = fingerprintTree(fixture.root).treeHash
    assert.notEqual(before, after)
  })

  test('picks up a new file the caller never staged — a scaffold transform writes without committing', () => {
    const fixture = freshFixture()
    const before = fingerprintTree(fixture.root).treeHash
    writeFileSync(path.join(fixture.root, 'new-generated-file.txt'), 'from a transform')
    const after = fingerprintTree(fixture.root)
    assert.notEqual(after.treeHash, before)
    assert.equal(after.fileCount, fingerprintTree(fixture.root).fileCount)
  })

  test('does not throw and reflects a deletion the caller never committed (regression)', () => {
    // A real scaffold transform (e.g. init:project --mode=single) deletes
    // tracked files without committing. git ls-files alone would still list
    // the deleted path and hashFile() would throw ENOENT reading it.
    const fixture = freshFixture()
    const before = fingerprintTree(fixture.root)
    rmSync(path.join(fixture.root, 'apps/web/messages/ru.json'))
    const after = fingerprintTree(fixture.root)
    assert.equal(after.fileCount, before.fileCount - 1)
    assert.notEqual(after.treeHash, before.treeHash)
  })

  test('reports fileCount matching git ls-files', () => {
    const fixture = freshFixture()
    const tracked = git(fixture.root, ['ls-files']).trim().split('\n').filter(Boolean)
    assert.equal(fingerprintTree(fixture.root).fileCount, tracked.length)
  })

  test('extracts significant PROJECT_CONTEXT.md fields explicitly, not folded into the opaque hash alone', () => {
    const fixture = freshFixture()
    const { significantValues } = fingerprintTree(fixture.root)
    assert.equal(significantValues.i18n_mode, null) // fixture repo has no such field
    assert.ok('base_locale' in significantValues)
  })
})

describe('groupCandidateEquivalents', () => {
  test('groups only scenarios sharing an identical treeHash', () => {
    const groups = groupCandidateEquivalents([
      { scenarioName: 'a', treeHash: 'x' },
      { scenarioName: 'b', treeHash: 'x' },
      { scenarioName: 'c', treeHash: 'y' },
    ])
    assert.deepEqual(groups, [['a', 'b']])
  })

  test('never reports a singleton group', () => {
    const groups = groupCandidateEquivalents([
      { scenarioName: 'a', treeHash: 'x' },
      { scenarioName: 'b', treeHash: 'y' },
    ])
    assert.deepEqual(groups, [])
  })
})
