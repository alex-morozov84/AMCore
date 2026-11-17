import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSelectionSource } from './ci-selection-source.mjs'

test('event identities, retained merges and unavailable history remain distinct', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-ancestry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  const commit = () => {
    git('add', '.')
    git('commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  writeFileSync(join(root, 'README.md'), 'base')
  const base = commit()
  git('switch', '-qc', 'source')
  writeFileSync(join(root, 'api.txt'), 'source')
  commit()
  git('switch', '-q', 'main')
  writeFileSync(join(root, 'README.md'), 'product')
  commit()
  git('merge', '--no-ff', '-qm', 'source update', 'source')
  const head = git('rev-parse', 'HEAD')
  assert.equal(readSelectionSource(root, 'push', { before: base }, head).integration, true)
  const pr = readSelectionSource(
    root,
    'pull_request',
    { pull_request: { base: { sha: base }, head: { sha: head } } },
    base
  )
  assert.deepEqual(pr.source, { base, head })
  assert.equal(pr.diffComplete, true)
  for (const before of ['0'.repeat(40), 'f'.repeat(40)])
    assert.equal(readSelectionSource(root, 'push', { before }, head).diffComplete, false)
  assert.throws(() => readSelectionSource(root, 'pull_request', {}, head), /exact/)
  assert.throws(() => readSelectionSource(root, 'push', {}, '--help'), /exact/)
  assert.throws(() => readSelectionSource(root, 'pull_request_target', {}, head), /Unsupported/)
})
