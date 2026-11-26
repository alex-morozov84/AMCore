import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { prepareBrandInit } from './brand-init-plan.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'
import { consoleEdgeFiles } from './console-edge.mjs'
import { productAdminEdgeFiles } from './product-admin-edge.mjs'

test('initialization previews and applies locale settings, installation metadata and edge files together', (t) => {
  const { root, cleanup } = createWorkingTreeCopy()
  t.after(cleanup)
  const read = (file) => readFileSync(join(root, file), 'utf8')
  const manifest = 'apps/web/src/app/manifest.ts'
  const locales = 'packages/shared/src/config/locales.json'
  const english = 'apps/web/messages/en.json'
  const { operationPlan } = prepareBrandInit(root, {
    productSetup: true,
    amcoreVersion: 'v1.0.0',
    locales: 'ru',
    consoleMode: 'disabled',
    nameRu: 'Мой каталог',
    nameEn: 'My catalog',
    descriptionRu: 'Личный список приложений',
    themeAvailability: 'dark',
    routeProgress: 'off',
    ciMode: 'heavy-off',
  })
  assert.equal(JSON.parse(read(locales)).default, 'en')
  assert.match(read(manifest), /name: 'AMCore'/)
  assert.ok(
    operationPlan.displaySteps.some(({ target }) => target.endsWith('operations-console.conf'))
  )
  applyFilesystemTransaction({ root, operations: operationPlan.operationsForApply() })
  assert.deepEqual(JSON.parse(read(locales)), { version: 1, enabled: ['ru'], default: 'ru' })
  assert.equal(JSON.parse(read(english)).meta.description, 'My catalog')
  assert.match(read(manifest), /description: 'Личный список приложений'/)
  assert.equal(JSON.parse(read('package.json')).description, 'Личный список приложений')
  assert.ok(consoleEdgeFiles(root))
  productAdminEdgeFiles(root)

  const after = JSON.parse(read(english))
  after.meta.description = 'A reviewed translation'
  writeFileSync(join(root, english), JSON.stringify(after, null, 2) + '\n')
  const replay = prepareBrandInit(root, {
    productSetup: true,
    locales: 'en,ru',
    defaultLocale: 'en',
  })
  applyFilesystemTransaction({ root, operations: replay.operationPlan.operationsForApply() })
  assert.equal(JSON.parse(read(english)).meta.description, 'A reviewed translation')
  assert.match(read(manifest), /description: 'A reviewed translation'/)
  assert.match(read('PROJECT_CONTEXT.md'), /initialized_from_amcore_version:\*\* v1\.0\.0/)
})
