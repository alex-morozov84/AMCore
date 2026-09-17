import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { brandContentDefinition } from './brand-content-operations.mjs'
import { prepareBrandInit } from './brand-init-plan.mjs'
import { BRAND_SEAMS } from './brand-ownership.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import { createFixtureRepo } from './test-fixture.mjs'

let fixture
afterEach(() => fixture?.cleanup())

test('brand operation keys and owned semantic claims are stable', () => {
  fixture = createFixtureRepo()
  const { facts } = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Tagline',
    packageName: 'acme',
    themeMode: 'dark',
  })
  assert.deepEqual(
    facts.map(({ path, operationKey }) => [path, operationKey]),
    [
      ['PROJECT_CONTEXT.md', 'brand.context-fields'],
      ['package.json', 'brand.package-fields'],
      ['apps/web/src/app/manifest.ts', 'brand.set-manifest-fields'],
      ['apps/web/messages/en.json', 'brand.messages-en-meta'],
      ['apps/web/messages/ru.json', 'brand.messages-ru-meta'],
      ['apps/web/src/shared/lib/theme.ts', 'brand.set-theme-default'],
    ]
  )
  assert.deepEqual(
    BRAND_SEAMS.map(({ id, operationKey }) => [id, operationKey ?? null]),
    [
      ['brand.context.identity', null],
      ['brand.package.name', null],
      ['brand.package.description', null],
      ['brand.manifest.fields', 'brand.set-manifest-fields'],
      ['brand.messages.en.meta', null],
      ['brand.messages.ru.title', null],
      ['brand.theme.default', 'brand.set-theme-default'],
    ]
  )
})

test('text and TypeScript operations expose narrow semantic locations', () => {
  const context = brandContentDefinition('brand.context-fields').claims({
    fields: [{ label: 'Product', value: 'Acme' }],
  })
  assert.deepEqual(context, [{ location: 'markdown:field:Product', value: 'Acme' }])
  const registry = createProjectStructuralRegistry()
  const manifest = registry
    .get('brand.set-manifest-fields')
    .deriveSemanticWrites({ name: 'Acme', short_name: 'Acme' })
  assert.deepEqual(manifest, [
    { location: 'ts:manifest:name', value: 'Acme' },
    { location: 'ts:manifest:short_name', value: 'Acme' },
  ])
})
