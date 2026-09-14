import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertNoRelevantUnresolvedReferences } from './ownership-dynamic.mjs'
import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { createImportGraph } from './ownership-import-graph.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { fixture, testManifest } from './ownership-test-support.mjs'

test('graph resolves aliases plus import, export, require and literal dynamic import forms', () => {
  const root = fixture({
    'src/app.ts':
      '/// <reference path="./types.d.ts" />\n' +
      "import '@/shared/a'\nvoid import('@/shared/lazy')\n",
    'src/feature/entry.ts': 'export const feature = true\n',
    'src/shared/a.ts': "export { value } from './b'\n",
    'src/shared/b.ts':
      "const feature = require('../feature/entry')\nexport const value = feature\n",
    'src/shared/lazy.ts': 'export const lazy = true\n',
    'src/types.d.ts': 'export interface Marker {}\n',
    'config.json': '{}',
  })
  const manifest = testManifest()
  const inventory = validateManifestInventory(root, manifest)
  const graph = createImportGraph(root, manifest, inventory)
  assert.deepEqual(
    graph.forward
      .get('src/app.ts')
      .map((edge) => edge.target)
      .sort(),
    ['src/shared/a.ts', 'src/shared/lazy.ts', 'src/types.d.ts']
  )
  assert.equal(graph.reverse.get('src/feature/entry.ts')[0].importer, 'src/shared/b.ts')
  assert.ok(graph.forward.get('src/app.ts').some((edge) => edge.dynamic))
  assert.equal(graph.unresolved.length, 0)
})

test('a relevant non-literal dynamic import is a blocker, unrelated one is not', () => {
  const root = fixture({
    'src/app.ts': "const name = './unrelated'; void import(name)\n",
    'src/feature/entry.ts': "const name = './hidden'; void import(name)\n",
    'config.json': '{}',
  })
  const manifest = testManifest()
  const inventory = validateManifestInventory(root, manifest)
  const graph = createImportGraph(root, manifest, inventory)
  assert.throws(
    () => assertNoRelevantUnresolvedReferences(root, manifest, inventory, graph),
    (error) => error.code === OWNERSHIP_CODES.DYNAMIC_REFERENCE && error.paths.length === 1
  )
})

test('an unresolved reference inside a declared shared module is a blocker', () => {
  const root = fixture({
    'src/app.ts': 'export const app = true\n',
    'src/feature/entry.ts': 'export const feature = true\n',
    'src/shared/helper.ts': "const name = './hidden'; void import(name)\n",
    'config.json': '{}',
  })
  const manifest = testManifest({
    facts: { sharedModules: [{ path: 'src/shared/helper.ts', kind: 'file', cardinality: 'one' }] },
  })
  const inventory = validateManifestInventory(root, manifest)
  const graph = createImportGraph(root, manifest, inventory)
  assert.throws(
    () => assertNoRelevantUnresolvedReferences(root, manifest, inventory, graph),
    (error) => error.code === OWNERSHIP_CODES.DYNAMIC_REFERENCE
  )
})
