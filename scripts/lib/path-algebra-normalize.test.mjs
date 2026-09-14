import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRelativePath, isAncestor, isRelated, InvalidPathError } from './path-algebra-normalize.mjs'

describe('normalizeRelativePath', () => {
  test('accepts an ordinary repository-relative path unchanged', () => {
    assert.equal(normalizeRelativePath('apps/web/src/foo.ts'), 'apps/web/src/foo.ts')
  })

  test('collapses internal "." and resolves internal ".." without escaping', () => {
    assert.equal(normalizeRelativePath('apps/./web/../web/src/foo.ts'), 'apps/web/src/foo.ts')
  })

  test('rejects an absolute POSIX path', () => {
    assert.throws(() => normalizeRelativePath('/etc/passwd'), InvalidPathError)
  })

  test('rejects an absolute Windows-style path', () => {
    assert.throws(() => normalizeRelativePath('C:\\Windows\\System32'), InvalidPathError)
  })

  test('rejects Windows rooted and UNC paths', () => {
    assert.throws(() => normalizeRelativePath(String.raw`\rooted`), InvalidPathError)
    assert.throws(() => normalizeRelativePath(String.raw`\\server\share`), InvalidPathError)
  })

  test('rejects a path that escapes the repository root via ".."', () => {
    assert.throws(() => normalizeRelativePath('../etc/passwd'), InvalidPathError)
  })

  test('rejects a path that escapes only after internal segments are resolved', () => {
    assert.throws(() => normalizeRelativePath('apps/../../etc/passwd'), InvalidPathError)
  })

  test('rejects an empty string', () => {
    assert.throws(() => normalizeRelativePath(''), InvalidPathError)
  })

  test('rejects a path that resolves to the repository root itself', () => {
    assert.throws(() => normalizeRelativePath('.'), InvalidPathError)
  })
})

describe('isAncestor — component-wise, not string-prefix', () => {
  test('a directory is an ancestor of a file inside it', () => {
    assert.equal(isAncestor('foo', 'foo/bar.ts'), true)
  })

  test('"foo" is NOT an ancestor of "foobar" (the real B1 regression)', () => {
    assert.equal(isAncestor('foo', 'foobar'), false)
    assert.equal(isAncestor('foo', 'foobar/baz.ts'), false)
  })

  test('a path is not its own ancestor', () => {
    assert.equal(isAncestor('foo/bar', 'foo/bar'), false)
  })

  test('a descendant is not an ancestor of its own ancestor', () => {
    assert.equal(isAncestor('foo/bar', 'foo'), false)
  })

  test('unrelated sibling paths are not ancestors of each other', () => {
    assert.equal(isAncestor('foo/bar', 'foo/baz'), false)
  })

  test('works at arbitrary depth', () => {
    assert.equal(isAncestor('a', 'a/b/c/d.ts'), true)
  })
})

describe('isRelated', () => {
  test('true for identical paths', () => {
    assert.equal(isRelated('foo/bar', 'foo/bar'), true)
  })

  test('true regardless of which side is the ancestor', () => {
    assert.equal(isRelated('foo', 'foo/bar'), true)
    assert.equal(isRelated('foo/bar', 'foo'), true)
  })

  test('false for disjoint siblings', () => {
    assert.equal(isRelated('foo/bar', 'foo/baz'), false)
  })

  test('false for the "foo" vs "foobar" case', () => {
    assert.equal(isRelated('foo', 'foobar'), false)
  })
})
