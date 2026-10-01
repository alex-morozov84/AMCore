import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { commit, runInitProject } from './init-project-test-helpers.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const copyTest = 'apps/web/src/_pages/console/OverviewPage/overview-copy.test.ts'
const retained = [
  'apps/api/src/infrastructure/storage/storage-probe.service.ts',
  'apps/api/src/infrastructure/storage/storage-public.controller.ts',
  'apps/api/scripts/build-identity.mjs',
  'packages/shared/src/schemas/admin-overview.ts',
  'docs/operations/runbooks/storage.md',
]
const scenarios = [
  ['multi disabled', ['--admin-console=disabled']],
  [
    'en path',
    ['--mode=single', '--locale=en', '--admin-console=path', '--admin-console-slug=panel'],
  ],
  ['ru host', ['--mode=single', '--locale=ru', '--admin-console=host']],
  ['en host', ['--mode=single', '--locale=en', '--admin-console=host']],
  [
    'ru path',
    ['--mode=single', '--locale=ru', '--admin-console=path', '--admin-console-slug=panel'],
  ],
  ['en disabled', ['--mode=single', '--locale=en', '--admin-console=disabled']],
  ['ru disabled', ['--mode=single', '--locale=ru', '--admin-console=disabled']],
]

function checkDisabled(root) {
  assert.equal(existsSync(path.join(root, copyTest)), false)
  for (const name of retained) assert.ok(existsSync(path.join(root, name)), name)
  for (const name of [
    'docs/operations/deployment.md',
    'docs/operations/observability.md',
    'docs/storage/configuration.md',
    'docs/operations/runbooks/storage.md',
  ]) {
    const text = readFileSync(path.join(root, name), 'utf8')
    assert.doesNotMatch(text, /operations-console\//, name)
  }
  const deployment = readFileSync(path.join(root, 'docs/operations/deployment.md'), 'utf8')
  assert.match(deployment, /API build automatically records/)
  const runbook = readFileSync(path.join(root, retained.at(-1)), 'utf8')
  assert.match(runbook, /AMCoreStorageProbeFailed/)
  assert.match(runbook, /storage_probe_failed/)
}

for (const [name, flags] of scenarios) {
  test(`Overview current-candidate CLI projection: ${name}`, () => {
    const fixture = createWorkingTreeCopy()
    try {
      commit(fixture.root)
      const result = runInitProject(fixture.root, [...flags, '--yes'])
      assert.equal(result.status, 0, result.stderr)
      if (flags.includes('--admin-console=disabled')) return checkDisabled(fixture.root)
      const locale = flags.includes('--locale=ru') ? 'ru' : 'en'
      const other = locale === 'en' ? 'ru' : 'en'
      const text = readFileSync(path.join(fixture.root, copyTest), 'utf8')
      assert.match(text, new RegExp(`/messages/${locale}\\.json`))
      assert.doesNotMatch(text, new RegExp(`/messages/${other}\\.json`))
      assert.match(text, new RegExp(`const catalogues = \\{ ${locale} \\}`))
      assert.ok(existsSync(path.join(fixture.root, `apps/web/messages/${locale}.json`)))
      assert.equal(existsSync(path.join(fixture.root, `apps/web/messages/${other}.json`)), false)
    } finally {
      fixture.cleanup()
    }
  })
}
