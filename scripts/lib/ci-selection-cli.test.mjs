import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const command = join(import.meta.dirname, '../ci-selection.mjs')
test('actual selector activates only admitted independent web changes and refuses unsupported preparation', (t) => {
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
  const cataloguePath = 'packages/shared/src/constants/locales.ts'
  const catalogue = readFileSync(
    new URL('../../packages/shared/src/constants/locales.ts', import.meta.url),
    'utf8'
  )
  put(cataloguePath, catalogue)
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
  const output = join(control, 'outputs.txt')
  const result = invoke({ GITHUB_OUTPUT: output })
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(output, 'utf8'), /server=false\n/)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.proposed.api, false)
  assert.equal(plan.reason, 'independent-web')
  assert.equal(plan.effective.length, 12)
  for (const retained of [
    'test-unit-redis',
    'web-e2e-plan',
    'web-e2e-lanes',
    'web-e2e',
    'storybook',
  ])
    assert.ok(plan.effective.includes(retained))
  assert.deepEqual(plan.source, { base, head })
  for (const owner of ['web', 'docs', 'common', 'api', 'deployment', 'infra', 'tools', 'email']) {
    const wideOutputs = { ...outputs, [owner + '_files']: '["leaf.tsx"]' }
    if (owner === 'web') wideOutputs.ui_files = '[]'
    const actual = invoke({ CI_FILTER_OUTPUTS: JSON.stringify(wideOutputs) })
    assert.equal(actual.status, 0, actual.stderr)
    assert.equal(JSON.parse(actual.stdout).reason, owner === 'web' ? 'independent-web' : 'broad')
  }
  const fullOutput = join(control, 'full-output.txt')
  const fullResult = invoke({
    GITHUB_OUTPUT: fullOutput,
    CI_FILTER_OUTPUTS: JSON.stringify({ ...outputs, common_files: '["leaf.tsx"]' }),
  })
  assert.equal(fullResult.status, 0, fullResult.stderr)
  assert.match(readFileSync(fullOutput, 'utf8'), /server=true\n/)
  assert.equal(invoke({ CI_FILTER_OUTPUTS: '{}' }).status, 1)
  assert.equal(invoke({ GITHUB_RUN_ATTEMPT: '' }).status, 1)
  assert.equal(invoke({ GITHUB_SHA: 'f'.repeat(40) }).status, 1)
  put('packages/shared/src/config/admin-console.json', '{"version":1,"mode":"host","alias":"ops"}')
  const host = commit()
  assert.equal(invoke({ GITHUB_SHA: host }).status, 1)
  put('ci/product.json', '{"version":1,"mode":"heavy-off"}')
  const heavy = commit()
  assert.equal(invoke({ GITHUB_SHA: heavy }).status, 1)
  // Restore unrelated admission inputs before each independent locale refusal.
  put('ci/product.json', '{"version":1,"mode":"normal"}')
  for (const locales of [
    { version: 1, enabled: ['en'], default: 'en' },
    { version: 1, enabled: ['ru'], default: 'ru' },
    { version: 1, enabled: ['en', 'ru'], default: 'ru' },
  ]) {
    put(
      'packages/shared/src/config/admin-console.json',
      JSON.stringify(settings['admin-console.json'])
    )
    put('packages/shared/src/config/locales.json', JSON.stringify(locales))
    const failed = invoke({ GITHUB_SHA: commit() })
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /supports source S0 only/)
  }
  put('packages/shared/src/config/locales.json', JSON.stringify(settings['locales.json']))
  put(cataloguePath, catalogue + '\n// Deliberate source/checkout mismatch\n')
  const differentCatalogue = commit()
  const mismatch = invoke({ GITHUB_SHA: differentCatalogue })
  assert.equal(mismatch.status, 1)
  assert.match(mismatch.stderr, /catalogue definition/)
  put(cataloguePath, catalogue)
  const restored = commit()
  writeFileSync(event, JSON.stringify({ before: differentCatalogue }))
  const baselineMismatch = invoke({ GITHUB_SHA: restored })
  assert.equal(baselineMismatch.status, 1)
  assert.match(baselineMismatch.stderr, /catalogue definition/)
  writeFileSync(event, JSON.stringify({ before: base }))
  assert.equal(invoke({ GITHUB_SHA: restored }).status, 0)
})
