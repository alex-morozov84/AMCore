import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCommittedCopy, runInitProject } from './init-project-test-helpers.mjs'

for (const flags of [
  ['--mode=single', '--locale=ru', '--admin-console=disabled'],
  ['--mode=single', '--locale=en', '--admin-console=host', '--admin-console-slug=ops'],
])
  test(`actual initializer retains exact Lighthouse owner/coverage contracts: ${flags.join(' ')}`, async () => {
    const copies = []
    try {
      const root = createCommittedCopy(copies)
      const result = runInitProject(root, [...flags, '--yes'])
      assert.equal(result.status, 0, result.stderr || result.stdout)
      const { auditPlan, auditCatalogue } = await import(
        pathToFileURL(join(root, 'scripts/lib/lighthouse-plan.mjs')).href
      )
      const plan = auditPlan(root, { run: '123', attempt: '1', source: 'a'.repeat(40) })
      const disabled = flags.includes('--admin-console=disabled')
      const scenarios = auditCatalogue(root).scenarios.map((s) => s.id)
      assert.deepEqual(
        scenarios,
        disabled ? ['login', 'members'] : ['login', 'members', 'console-overview']
      )
      assert.equal(plan.choices.multi, false)
      assert.equal(plan.choices.locale, disabled ? 'ru' : 'en')
      assert.equal(
        existsSync(join(root, 'apps/web/e2e/console-real-stack/lighthouse/catalogue.json')),
        !disabled
      )
      assert.equal(Object.values(plan.assignments).flat().length, disabled ? 2 : 3)
      const fixture = readFileSync(
        join(root, 'apps/web/src/shared/api/bff/browser-auth-flow.integration.test.ts'),
        'utf8'
      )
      assert.doesNotMatch(fixture, /locale: 'en'/)
      assert.match(fixture, /locale: DEFAULT_LOCALE/)
      if (disabled)
        assert.doesNotMatch(
          readFileSync(join(root, 'scripts/lighthouse/fixture.mjs'), 'utf8'),
          /setSystemRole|accessPath/
        )
      else assert.ok(plan.assignments.host.includes('console-overview'))
    } finally {
      for (const copy of copies) copy.cleanup()
    }
  })
