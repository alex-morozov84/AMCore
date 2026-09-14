import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
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

  test('does not change for an untracked (never git add-ed) file', () => {
    const fixture = freshFixture()
    const before = fingerprintTree(fixture.root).treeHash
    writeFileSync(path.join(fixture.root, 'scratch-untracked.txt'), 'noise')
    assert.equal(fingerprintTree(fixture.root).treeHash, before)
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
