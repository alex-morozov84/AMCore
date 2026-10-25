import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

import { commit, runInitProject } from './init-project-test-helpers.mjs'
import { createLintFixture } from './lint-fixture.mjs'

for (const [name, flags] of [
  [
    'combined',
    [
      '--mode=single',
      '--locale=ru',
      '--storybook=disabled',
      '--route-progress=disabled',
      '--admin-console=disabled',
    ],
  ],
  ['path', ['--admin-console=path', '--admin-console-slug=panel']],
  ['host', ['--admin-console=host']],
]) {
  test(`actual ${name} CLI keeps network guard and exact surviving adapters`, async () => {
    const copy = createLintFixture()
    try {
      commit(copy.root)
      const result = runInitProject(copy.root, [...flags, '--yes'])
      assert.equal(result.status, 0, result.stderr)
      const { RAW_FETCH_FILES } = await import(
        pathToFileURL(path.join(copy.root, 'apps/web/network-policy.mjs'))
      )
      assert.equal(RAW_FETCH_FILES.length, name === 'combined' ? 10 : 13)
      assert.equal(new Set(RAW_FETCH_FILES).size, RAW_FETCH_FILES.length)
      for (const file of RAW_FETCH_FILES)
        assert.ok(existsSync(path.join(copy.root, 'apps/web', file)), file)
      const diagnostics = copy.lint(
        'export const x = globalThis.fetch("/api")',
        'src/shared/api/downstream-probe.ts'
      )
      assert.ok(diagnostics.some((item) => item.ruleId === 'no-restricted-properties'))
      const safe = copy.lint(
        'const fetch = () => 1; export const x = fetch()',
        'src/shared/api/downstream-probe.ts'
      )
      assert.deepEqual(safe, [])
    } finally {
      copy.cleanup()
    }
  })
}
