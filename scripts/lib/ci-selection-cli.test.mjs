import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requiredCiJobs } from './ci-required.mjs'

const command = join(import.meta.dirname, '../ci-selection.mjs')
test('actual bridge reports narrow diagnostics but keeps all groups and refuses unsupported preparation', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-bridge-source-'))
  const control = mkdtempSync(join(tmpdir(), 'ci-bridge-control-'))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(control, { recursive: true, force: true })
  })
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  const put = (file, value) => {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), value)
  }
  put('PROJECT_CONTEXT.md', '- **Mode:** `upstream-starter`\n')
  const settings = {
    'locales.json': { version: 1, enabled: ['en', 'ru'], default: 'en' },
    'admin-console.json': { version: 1, mode: 'path', alias: 'admin' },
    'product-admin.json': { version: 1, mode: 'path', alias: 'manage' },
  }
  for (const [file, value] of Object.entries(settings))
    put('packages/shared/src/config/' + file, JSON.stringify(value))
  const commit = () => {
    git('add', '.')
    git('commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const base = commit()
  put('leaf.tsx', 'heading')
  const head = commit()
  const event = join(control, 'event.json')
  writeFileSync(event, JSON.stringify({ before: base }))
  const outputs = Object.fromEntries(
    [
      'all',
      'docs',
      'ui',
      'web',
      'api',
      'common',
      'infra',
      'monitoring',
      'tools',
      'email',
      'deployment',
    ].map((key) => [key + '_files', ['all', 'ui', 'web'].includes(key) ? '["leaf.tsx"]' : '[]'])
  )
  const env = {
    PATH: process.env.PATH,
    GITHUB_EVENT_PATH: event,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_SHA: head,
    GITHUB_REPOSITORY: 'alex-morozov84/AMCore',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    CI_FILTER_OUTPUTS: JSON.stringify(outputs),
  }
  const invoke = (extra = {}) =>
    spawnSync(process.execPath, [command], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, ...extra },
    })
  const result = invoke()
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.proposed.api, false)
  assert.deepEqual(plan.effective, requiredCiJobs)
  assert.deepEqual(plan.source, { base, head })
  assert.equal(invoke({ CI_FILTER_OUTPUTS: '{}' }).status, 1)
  assert.equal(invoke({ GITHUB_RUN_ATTEMPT: '' }).status, 1)
  assert.equal(invoke({ GITHUB_SHA: 'f'.repeat(40) }).status, 1)
  put('packages/shared/src/config/admin-console.json', '{"version":1,"mode":"host","alias":"ops"}')
  const host = commit()
  assert.equal(invoke({ GITHUB_SHA: host }).status, 1)
  put('ci/product.json', '{"version":1,"mode":"heavy-off"}')
  const heavy = commit()
  assert.equal(invoke({ GITHUB_SHA: heavy }).status, 1)
})
