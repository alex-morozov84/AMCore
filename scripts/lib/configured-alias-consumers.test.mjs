import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { auditChoices } from './lighthouse-plan.mjs'
import { scopeRegistry } from './route-budget-policy.mjs'

test('Lighthouse and route budgets consume the same validated aliases', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'configured-alias-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = join(root, 'packages/shared/src/config')
  mkdirSync(directory, { recursive: true })
  const save = (file, value) =>
    writeFileSync(join(directory, file + '.json'), JSON.stringify(value))
  save('locales', { version: 1, enabled: ['ru'], default: 'ru' })
  const configure = (productAlias, consoleAlias) => {
    save('product-admin', { version: 1, mode: 'host', alias: productAlias })
    save('admin-console', { version: 1, mode: 'host', alias: consoleAlias })
  }
  configure('staff_portal', 'ops_panel')
  const choices = auditChoices(root)
  assert.equal(choices.productAdmin.alias, 'staff_portal')
  assert.equal(choices.console.slug, 'ops_panel')
  assert.deepEqual(
    scopeRegistry(root).resolvers.map(({ prefix }) => prefix),
    ['/staff_portal', '/ops_panel']
  )
  for (const aliases of [
    ['ru', 'ops_panel'],
    ['staff_portal', 'X'],
    ['3staff', 'ops_panel'],
    ['staff_portal', 'api'],
  ]) {
    configure(...aliases)
    for (const consumer of [auditChoices, scopeRegistry]) assert.throws(() => consumer(root))
  }
})
