import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { inheritedBrowserChanges } from './inherited-browser-changes.mjs'

test('a product follow-up preserves inherited provenance through PR and delivery merges', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'inherited-browser-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init', '-qb', 'upstream')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  const file = 'apps/web/e2e/console-real-stack/overview.spec.ts'
  mkdirSync(join(root, dirname(file)), { recursive: true })
  const commit = (changed, text) => {
    writeFileSync(join(root, changed), text)
    git('add', changed)
    git('commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  commit('PROJECT_CONTEXT.md', '- **Mode:** `upstream-starter`\n')
  const common = commit(file, '// initial')
  const update = commit(file, '// source update')
  git('switch', '-qc', 'product', common)
  const base = commit('PROJECT_CONTEXT.md', '- **Mode:** `downstream-product`\n')
  git('merge', '--no-ff', '-qm', 'source merge', update)
  const head = commit('product.txt', 'product follow-up')
  const checkout = git(
    'commit-tree',
    git('rev-parse', `${head}^{tree}`),
    '-p',
    base,
    '-p',
    head,
    '-m',
    'PR merge'
  )
  assert.deepEqual(inheritedBrowserChanges(root, { base, head, checkout }, [file]), [file])
  assert.deepEqual(inheritedBrowserChanges(root, { base, head: checkout, checkout }, [file]), [
    file,
  ])

  const changed = commit(file, '// modified by product')
  assert.deepEqual(
    inheritedBrowserChanges(root, { base, head: changed, checkout: changed }, [file]),
    []
  )
})
