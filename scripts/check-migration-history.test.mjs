import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const checker = fileURLToPath(new URL('./check-migration-history.mjs', import.meta.url))
const migration = 'apps/api/prisma/migrations/20260101000000_base/migration.sql'
const added = 'apps/api/prisma/migrations/20260102000000_new/migration.sql'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'amcore-history-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'core.hooksPath', join(root, 'empty-hooks'))
  git('config', 'commit.gpgsign', 'false')
  const put = (path, text) => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const commit = () => {
    git('add', '-A')
    git('commit', '-m', 'chore: fixture')
  }
  put(migration, 'CREATE TABLE original(id int);\n')
  commit()
  git('checkout', '-b', 'change')
  return { root, git, put, commit }
}

function merge(f) {
  f.commit()
  f.git('checkout', 'main')
  f.git('merge', '--no-ff', 'change', '-m', 'chore: merge fixture')
}

function check(root, sha, extra = {}) {
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: sha, ...extra },
  })
}

for (const change of ['add', 'edit', 'delete', 'rename', 'add-then-edit']) {
  test(`shared migration history: ${change}`, (t) => {
    const f = fixture(t)
    if (change === 'add' || change === 'add-then-edit') f.put(added, 'CREATE TABLE next(id int);\n')
    if (change === 'edit') f.put(migration, 'CREATE TABLE replacement(id int);\n')
    if (change === 'delete') rmSync(join(f.root, migration))
    if (change === 'rename') renameSync(join(f.root, migration), join(f.root, migration + '.old'))
    if (change === 'add-then-edit') {
      f.commit()
      f.put(added, 'CREATE TABLE revised(id int);\n')
    }
    merge(f)
    const result = check(f.root, f.git('rev-parse', 'HEAD'))
    const accepted = change === 'add' || change === 'add-then-edit'
    assert.equal(result.status, accepted ? 0 : 1, result.stderr)
    if (!accepted) assert.ok(result.stderr.includes(migration))
  })
}

test('uses the actual first parent, preserving a migration added to a moving base', (t) => {
  const f = fixture(t)
  const staleBase = f.git('rev-parse', 'HEAD')
  f.put('feature.txt', 'feature\n')
  f.commit()
  f.git('checkout', 'main')
  f.put(added, 'CREATE TABLE main_added(id int);\n')
  f.commit()
  f.git('merge', '--no-ff', 'change', '-m', 'chore: merge fixture')
  const result = check(f.root, f.git('rev-parse', 'HEAD'), { GITHUB_BASE_SHA: staleBase })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /2 existing SQL files/)
})

test('refuses a head checkout, a mismatched SHA and non-PR invocation', (t) => {
  const f = fixture(t)
  const base = f.git('rev-parse', 'HEAD')
  assert.match(check(f.root, base).stderr, /two merge parents/)
  f.put(added, 'CREATE TABLE next(id int);\n')
  merge(f)
  assert.match(check(f.root, base).stderr, /HEAD differs/)
  assert.match(
    check(f.root, f.git('rev-parse', 'HEAD'), { GITHUB_EVENT_NAME: 'push' }).stderr,
    /pull_request/
  )
})

test('depth two works offline; depth one and missing parent objects fail closed', (t) => {
  const f = fixture(t)
  f.put(added, 'CREATE TABLE next(id int);\n')
  merge(f)
  const head = f.git('rev-parse', 'HEAD')
  for (const depth of [1, 2]) {
    const clone = join(f.root, `clone-${depth}`)
    execFileSync(
      'git',
      ['clone', '--depth', String(depth), '--no-local', pathToFileURL(f.root).href, clone],
      { stdio: 'pipe' }
    )
    const result = check(clone, head)
    assert.equal(result.status, depth === 2 ? 0 : 1, result.stderr)
  }
  const parent = f.git('rev-parse', 'HEAD^1')
  rmSync(join(f.root, '.git/objects', parent.slice(0, 2), parent.slice(2)))
  assert.equal(check(f.root, head).status, 1)
})

test('required Script contracts checks the default PR merge with depth two and no persisted credentials', () => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  )
  const steps = workflow.jobs['script-contracts'].steps
  const checkout = steps.find((step) => step.name === 'Checkout')
  assert.equal(checkout.with['fetch-depth'], 2)
  assert.equal(checkout.with['persist-credentials'], false)
  assert.equal(checkout.with.ref, undefined)
  const gate = steps.find((step) => step.run === 'node scripts/check-migration-history.mjs')
  assert.equal(gate.if, "github.event_name == 'pull_request'")
})
