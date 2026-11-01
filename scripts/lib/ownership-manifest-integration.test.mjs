import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { fileFact, fixture, testManifest, write } from './ownership-test-support.mjs'
import { validateOwnership } from './ownership-validate.mjs'

const base = {
  'src/app.ts': 'export const app = true\n',
  'src/feature/entry.ts': 'export const feature = true\n',
  'docs/feature/guide.md': '# Feature\n',
  'config.json': '{"enabled":true}\n',
}

const manifest = () =>
  testManifest({
    facts: {
      topology: [fileFact('config.json')],
      documentation: [{ glob: 'docs/feature/**/*.md', kind: 'file', cardinality: 'one-or-more' }],
    },
  })

function cloneManifest(change) {
  const draft = JSON.parse(JSON.stringify(manifest()))
  change(draft)
  return draft
}

test('a manifest lists real roots, facts and entrypoints against the working tree', () => {
  const root = fixture(base)
  const { inventory } = validateOwnership(root, manifest())
  assert.deepEqual(inventory.rootFiles.get('src/feature'), ['src/feature/entry.ts'])
})

test('a stale listed path fails closed', () => {
  const root = fixture(base)
  const draft = cloneManifest((item) => {
    item.facts.topology[0].path = 'missing.yml'
  })
  assert.throws(
    () => validateManifestInventory(root, draft),
    (error) => error.code === OWNERSHIP_CODES.STALE_ENTRY
  )
})

test('wrong kind and glob cardinality fail closed', () => {
  const root = fixture(base)
  const wrongKind = cloneManifest((draft) => {
    draft.facts.roots[0].kind = 'file'
  })
  assert.throws(
    () => validateManifestInventory(root, wrongKind),
    (error) => error.code === OWNERSHIP_CODES.KIND_MISMATCH
  )
  write(root, 'src/second.ts', 'export const second = true\n')
  const wrongCount = cloneManifest((draft) => {
    draft.facts.repositoryEntrypoints[0] = {
      glob: 'src/*.ts',
      kind: 'file',
      cardinality: 'one',
    }
  })
  assert.throws(
    () => validateManifestInventory(root, wrongCount),
    (error) => error.code === OWNERSHIP_CODES.CARDINALITY
  )
})

test('a duplicate owned-block anchor fails closed', () => {
  const root = fixture({ ...base, 'docs/mixed.md': 'FEATURE_TOKEN\nbetween\nFEATURE_TOKEN\n' })
  const draft = cloneManifest((item) => {
    item.seams.push({
      id: 'mixed-doc',
      ...fileFact('docs/mixed.md'),
      seamKind: 'owned-block',
      selector: { text: 'FEATURE_TOKEN' },
      detectors: ['FEATURE_TOKEN'],
      disposition: 'remove',
    })
  })
  assert.throws(
    () => validateOwnership(root, draft),
    (error) => error.code === OWNERSHIP_CODES.CARDINALITY
  )
})

test('a new file inside a closed-world root is discovered automatically', () => {
  const root = fixture(base)
  const relative = 'src/feature/new-owned-helper.ts'
  write(root, relative, 'export const owned = true\n')
  const { inventory } = validateOwnership(root, manifest())
  assert.ok(inventory.rootFiles.get('src/feature').includes(relative))
})

test('whole-file feature ownership outside a closed root is forbidden', () => {
  const root = fixture(base)
  const draft = cloneManifest((item) => {
    item.facts.featureFiles.push({ path: 'src/app.ts', kind: 'file', cardinality: 'one' })
  })
  assert.throws(
    () => validateManifestInventory(root, draft),
    (error) => error.code === OWNERSHIP_CODES.OUTSIDE_ROOT
  )
})
