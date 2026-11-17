import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeCiAreas, selectCiGroups } from './ci-selection.mjs'

const select = (areas, extra = {}) =>
  selectCiGroups({
    role: 'upstream-starter',
    mode: 'normal',
    diffComplete: true,
    areas,
    ...extra,
  })

test('unknown and cross-area files cannot disappear when broad lists overlap specific lists', () => {
  const names = [
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
  ]
  const outputs = Object.fromEntries(names.map((name) => [`${name}_files`, '[]']))
  const ui = 'apps/web/src/features/example/ui/Example.tsx'
  const file = 'apps/web/src/shared/ui/button.tsx'
  outputs.all_files = JSON.stringify([ui, file, 'unregistered.txt'])
  outputs.ui_files = JSON.stringify([ui])
  outputs.web_files = JSON.stringify([ui, file])
  const areas = normalizeCiAreas(outputs)
  assert.equal(areas.ui, true)
  assert.equal(areas.web, true)
  assert.equal(areas.unknown, true)
  assert.equal(select(areas).api, true)
  outputs.all_files = JSON.stringify([ui])
  assert.throws(() => normalizeCiAreas(outputs), /disagree/)
  assert.throws(() => normalizeCiAreas({}), SyntaxError)
  assert.throws(() => normalizeCiAreas({ ...outputs, all_files: '[null]' }), /Invalid/)
})

test('prose and local UI avoid unrelated runtime families without hiding UI coverage', () => {
  const docs = select({ docs: true })
  assert.equal(docs.quality, 'docs')
  assert.equal(docs.web, 'none')
  assert.equal(docs.api, false)
  assert.equal(docs.build, false)
  const ui = select({ ui: true })
  assert.equal(ui.web, 'ui')
  assert.equal(ui.storybook, true)
  assert.equal(ui.build, true)
  assert.deepEqual(ui.portability, ['web'])
  for (const group of [
    'api',
    'redis',
    'capability',
    'notification',
    'images',
    'fleet',
    'deployment',
  ])
    assert.equal(ui[group], false, group)
})

test('shared mechanisms, lost diff and source merges expand checks, but never override heavy-off', () => {
  for (const extra of [
    { areas: { common: true } },
    { diffComplete: false },
    { integration: true },
    { areas: {} },
    { areas: { unknown: true } },
  ]) {
    const wide = select({ ui: true }, extra)
    assert.equal(wide.api, true)
    assert.equal(wide.web, 'runtime')
    assert.equal(wide.images, true)
    const minimal = select(
      { ui: true },
      { ...extra, role: 'downstream-product', mode: 'heavy-off' }
    )
    for (const group of [
      'build',
      'api',
      'redis',
      'storybook',
      'capability',
      'notification',
      'images',
      'fleet',
      'deployment',
      'safety',
      'scripts',
    ])
      assert.equal(minimal[group], false, group)
    assert.equal(minimal.web, 'none')
    assert.equal(minimal.monitoring, 'static')
    assert.deepEqual(minimal.portability, [])
  }
})

test('other owned areas and mixed changes retain integration and role-specific obligations', () => {
  assert.equal(select({ web: true }).redis, true)
  assert.equal(select({ web: true }).api, false)
  assert.equal(select({ api: true }).api, true)
  assert.equal(select({ api: true }).web, 'runtime')
  assert.equal(select({ monitoring: true }).monitoring, 'live')
  assert.equal(select({ monitoring: true }).api, false)
  assert.equal(select({ infra: true }).images, true)
  assert.equal(select({ email: true }).email, true)
  assert.equal(select({ deployment: true }).deployment, true)
  const mixed = select({ ui: true, api: true })
  assert.equal(mixed.api, true)
  assert.equal(mixed.storybook, true)
  const product = select({ api: true }, { role: 'downstream-product' })
  assert.equal(product.capability, false)
  assert.equal(product.fleet, false)
  assert.equal(product.notification, true)
  assert.deepEqual(product.portability, [])
  assert.throws(() => select({ typo: true }))
  assert.throws(() => select({ ui: 'true' }))
})

test('packaging and email harness owners survive overlaps without overriding heavy-off', () => {
  const packaging = { web: true, infra: true, deployment: true }
  assert.equal(select(packaging).deployment, true)
  assert.equal(select(packaging).images, true)
  assert.equal(select(packaging).api, false)
  assert.equal(select({ api: true, email: true }).email, true)
  assert.equal(select({ api: true }).email, false)
  const minimal = { role: 'downstream-product', mode: 'heavy-off' }
  assert.equal(select(packaging, minimal).deployment, false)
  assert.equal(select({ api: true, email: true }, minimal).email, true)
})
