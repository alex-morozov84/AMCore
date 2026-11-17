import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const command = join(import.meta.dirname, '../ci-policy.mjs')

test('actual event command preserves PR choice and applies post-merge or explicit full-once', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-policy-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=fixture')
  git('config', 'user.name', 'Policy fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  mkdirSync(join(root, 'ci'))
  writeFileSync(join(root, 'PROJECT_CONTEXT.md'), '- **Mode:** `downstream-product`\n')
  const file = join(root, 'ci/product.json')
  const commit = (mode) => {
    writeFileSync(file, JSON.stringify({ version: 1, mode }))
    git('add', '--all')
    git('commit', '--quiet', '--allow-empty', '-m', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const invoke = (event, head, payload = {}, repository = 'example/product') => {
    const path = join(root, '.git/event.json')
    writeFileSync(path, JSON.stringify(payload))
    return spawnSync(process.execPath, [command], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_EVENT_NAME: event,
        GITHUB_REPOSITORY: repository,
        GITHUB_EVENT_PATH: path,
        GITHUB_SHA: head,
      },
    })
  }
  for (const [before, after] of [
    ['normal', 'heavy-off'],
    ['heavy-off', 'normal'],
    ['heavy-off', 'full'],
  ]) {
    const base = commit(before),
      head = commit(after)
    const pr = invoke('pull_request', base, {
      pull_request: { base: { sha: base }, head: { sha: head } },
    })
    assert.equal(pr.status, 0, pr.stderr)
    const result = JSON.parse(pr.stdout)
    assert.equal(result.mode, before)
    assert.equal(result.proposed, after)
    assert.equal(result.source.head, head)
    const push = invoke('push', head)
    assert.equal(push.status, 0, push.stderr)
    assert.equal(JSON.parse(push.stdout).mode, after)
  }
  const head = commit('heavy-off'),
    saved = readFileSync(file, 'utf8')
  for (const event of ['schedule', 'release']) {
    const result = invoke(event, head)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).mode, 'heavy-off')
  }
  const once = invoke('workflow_dispatch', head, { inputs: { 'full-once': 'true' } })
  assert.equal(once.status, 0, once.stderr)
  assert.equal(JSON.parse(once.stdout).mode, 'full')
  assert.equal(JSON.parse(once.stdout).saved, 'heavy-off')
  assert.equal(readFileSync(file, 'utf8'), saved)
  for (const response of [
    invoke('push', head, { inputs: { 'full-once': true } }),
    invoke('workflow_dispatch', head, { inputs: { 'full-once': 'yes' } }),
    invoke('push', head, {}, 'alex-morozov84/AMCore'),
    invoke('push', 'HEAD'),
    invoke('pull_request', head, {}),
    invoke('push', head, {}, ''),
    invoke('push', head, null),
  ]) {
    assert.equal(response.status, 1)
    assert.equal(response.stdout, '')
  }
  writeFileSync(file, '{')
  git('add', '--all')
  git('commit', '--quiet', '-m', 'malformed proposed policy')
  const invalid = git('rev-parse', 'HEAD')
  assert.equal(
    invoke('pull_request', head, {
      pull_request: { base: { sha: head }, head: { sha: invalid } },
    }).status,
    1
  )
  git('rm', '--quiet', 'ci/product.json')
  git('commit', '--quiet', '-m', 'remove optional policy')
  const deleted = git('rev-parse', 'HEAD')
  const proposal = invoke('pull_request', head, {
    pull_request: { base: { sha: head }, head: { sha: deleted } },
  })
  assert.equal(proposal.status, 0, proposal.stderr)
  assert.equal(JSON.parse(proposal.stdout).mode, 'heavy-off')
  assert.equal(JSON.parse(proposal.stdout).proposed, 'normal')
  assert.equal(JSON.parse(invoke('push', deleted).stdout).mode, 'normal')
})
