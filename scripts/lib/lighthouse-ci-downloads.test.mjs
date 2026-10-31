import test from 'node:test'
import assert from 'node:assert/strict'
import { ownerBundleDirectories } from './lighthouse-ci-evidence.mjs'

test('pinned Actions extracts one selected owner into the requested directory; refuse incomplete or extra files', () => {
  const owner = { lane: 'path-standard', expected: ['login', 'members', 'console-overview'] }
  const names = [
    'index.html',
    'payload.json.gz',
    'login.html',
    'members.html',
    'console-overview.html',
  ]
  const identity = { run: '123', attempt: '2' }
  assert.equal(
    ownerBundleDirectories('/download', [owner], names, identity).get(owner.lane),
    '/download'
  )
  for (const invalid of [
    names.slice(1),
    [...names, 'other.html'],
    ['web-lighthouse-123-2-path-standard'],
  ]) {
    assert.throws(
      () => ownerBundleDirectories('/download', [owner], invalid, identity),
      /unexpected-owner-artifact-set/
    )
  }
})

test('multiple selected owners retain exact run/attempt/lane directories', () => {
  const owners = [
    { lane: 'path-standard', expected: ['login'] },
    { lane: 'host', expected: ['console-overview'] },
  ]
  const names = ['web-lighthouse-123-2-host', 'web-lighthouse-123-2-path-standard']
  const identity = { run: '123', attempt: '2' }
  const directories = ownerBundleDirectories('/download', owners, names, identity)
  assert.equal(directories.get('host'), '/download/web-lighthouse-123-2-host')
  assert.equal(directories.get('path-standard'), '/download/web-lighthouse-123-2-path-standard')
  for (const invalid of [
    names.slice(1),
    [...names, 'foreign'],
    names.map((name) => name.replace('-2-', '-1-')),
  ]) {
    assert.throws(
      () => ownerBundleDirectories('/download', owners, invalid, identity),
      /unexpected-owner-artifact-set/
    )
  }
})
