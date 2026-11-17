import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readCiPolicyAt, readCiPolicySources } from './ci-policy-source.mjs'
import { resolveCiPolicy } from './ci-policy.mjs'

test('actual PR commits preserve base choice; push activates validated head including deletion', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-policy-source-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Policy fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  mkdirSync(join(root, 'ci'))
  const commit = (source) => {
    if (source === null) rmSync(join(root, 'ci/product.json'))
    else writeFileSync(join(root, 'ci/product.json'), source)
    git('add', '--', 'ci/product.json')
    git('commit', '--allow-empty', '-m', 'policy fixture')
    return git('rev-parse', 'HEAD')
  }
  const policy = (mode) => JSON.stringify({ version: 1, mode })
  const decide = (event, base, head) =>
    resolveCiPolicy({
      role: 'downstream-product',
      event,
      ...readCiPolicySources({ root, event, base, head }),
    })
  for (const [from, to] of [
    ['normal', 'heavy-off'],
    ['heavy-off', 'normal'],
    ['heavy-off', 'full'],
  ]) {
    const base = commit(policy(from)),
      head = commit(policy(to))
    assert.equal(decide('pull_request', base, head).mode, from)
    assert.equal(decide('pull_request', base, head).proposed, to)
    assert.equal(decide('push', base, head).mode, to)
  }
  const base = commit(policy('heavy-off'))
  const missingFile = commit(null)
  assert.equal(decide('pull_request', base, missingFile).mode, 'heavy-off')
  assert.equal(decide('push', base, missingFile).mode, 'normal')
  const malformed = commit('{')
  assert.throws(() => decide('pull_request', base, malformed), SyntaxError)
  assert.throws(() => readCiPolicyAt(root, 'HEAD'), /exact source commit/)
  assert.throws(() => decide('pull_request', '0'.repeat(40), missingFile))
})
