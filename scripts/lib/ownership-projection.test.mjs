import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createImportGraph } from './ownership-import-graph.mjs'
import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { projectOwnership } from './ownership-projection.mjs'
import { dirFact, fileFact, fixture, testManifest } from './ownership-test-support.mjs'
import { validateOwnership } from './ownership-validate.mjs'

function selection(root, manifest) {
  return { manifest, inventory: validateManifestInventory(root, manifest) }
}

function moduleFacts(files) {
  return files.map((file) => fileFact(file))
}

test('a helper reached only by its own test is not a production consumer', () => {
  const root = fixture({
    'src/app.ts': 'export const app = true\n',
    'src/feature/entry.ts': "import '../shared/helper'\n",
    'src/shared/helper.ts': 'export const helper = true\n',
    'test/helper.ts': "import '../src/shared/helper'\n",
    'config.json': '{}',
  })
  const manifest = testManifest({
    facts: {
      sharedModules: moduleFacts(['src/shared/helper.ts']),
      sharedModuleTests: [{ ...fileFact('test/helper.ts'), module: 'src/shared/helper.ts' }],
      repositoryEntrypoints: [fileFact('src/app.ts'), fileFact('test/helper.ts')],
    },
  })
  const selected = selection(root, manifest)
  const graph = createImportGraph(root, manifest, selected.inventory)
  const projection = projectOwnership(graph, [selected])
  assert.deepEqual([...projection.deadSharedModules], ['src/shared/helper.ts'])
  assert.ok(projection.removed.has('test/helper.ts'))
})

test('a barrel and isolated SCC do not create a production-reachable consumer', () => {
  const root = fixture({
    'src/app.ts': 'export const app = true\n',
    'src/feature/entry.ts': "import { a } from '@/shared/barrel'\nexport { a }\n",
    'src/shared/barrel.ts': "export { a } from './a'\n",
    'src/shared/a.ts': "import { b } from './b'\nexport const a = b\n",
    'src/shared/b.ts': "import { a } from './a'\nexport const b = () => a\n",
    'config.json': '{}',
  })
  const manifest = testManifest({
    facts: {
      sharedModules: moduleFacts(['src/shared/barrel.ts', 'src/shared/a.ts', 'src/shared/b.ts']),
      repositoryEntrypoints: [fileFact('src/app.ts'), fileFact('src/shared/barrel.ts')],
    },
  })
  const selected = selection(root, manifest)
  const graph = createImportGraph(root, manifest, selected.inventory)
  const projection = projectOwnership(graph, [selected])
  assert.ok(graph.barrels.has('src/shared/barrel.ts'))
  assert.equal(projection.deadSharedModules.size, 3)
})

test('a helper reached by a surviving production entrypoint remains universal', () => {
  const root = fixture({
    'src/app.ts':
      "import { helper } from '@/shared/helper'\nexport function app() { return helper }\n",
    'src/feature/entry.ts': "import '../shared/helper'\n",
    'src/shared/helper.ts': 'export const helper = true\n',
    'test/helper.ts': "import '../src/shared/helper'\n",
    'config.json': '{}',
  })
  const manifest = testManifest({
    facts: {
      sharedModules: moduleFacts(['src/shared/helper.ts']),
      sharedModuleTests: [{ ...fileFact('test/helper.ts'), module: 'src/shared/helper.ts' }],
    },
  })
  const selected = selection(root, manifest)
  const projection = projectOwnership(createImportGraph(root, manifest, selected.inventory), [
    selected,
  ])
  assert.deepEqual([...projection.universalSharedModules], ['src/shared/helper.ts'])
  assert.ok(!projection.removed.has('test/helper.ts'))
})

test('full validation accepts an independent production consumer of a universal helper', () => {
  const root = fixture({
    'src/app.ts': "import { helper } from '@/shared/helper'\nexport const app = helper\n",
    'src/feature/entry.ts': "import '../shared/helper'\n",
    'src/shared/helper.ts': 'export const helper = true\n',
    'config.json': '{}',
  })
  const manifest = testManifest({
    facts: { sharedModules: moduleFacts(['src/shared/helper.ts']) },
  })
  const result = validateOwnership(root, manifest)
  assert.ok(result.projection.universalSharedModules.has('src/shared/helper.ts'))
})

test('full validation rejects an undeclared test consumer of a dead shared helper', () => {
  const root = fixture({
    'src/app.ts': 'export const app = true\n',
    'src/feature/entry.ts': "import '../shared/helper'\n",
    'src/shared/helper.ts': 'export const helper = true\n',
    'test/orphan.ts': "import '../src/shared/helper'\n",
    'config.json': '{}',
  })
  const manifest = testManifest({
    facts: { sharedModules: moduleFacts(['src/shared/helper.ts']) },
  })
  assert.throws(
    () => validateOwnership(root, manifest),
    (error) => error.code === OWNERSHIP_CODES.MISSING_SEAM
  )
})

test('combined projection can remove the last independent consumer', () => {
  const root = fixture({
    'src/app.ts': 'export const app = true\n',
    'src/a/entry.ts': 'export const a = true\n',
    'src/b/entry.ts': "import '../shared/helper'\n",
    'src/shared/helper.ts': 'export const helper = true\n',
    'config.json': '{}',
  })
  const a = testManifest({
    feature: 'a',
    facts: {
      roots: [dirFact('src/a')],
      featureEntrypoints: [fileFact('src/a/entry.ts')],
      sharedModules: [fileFact('src/shared/helper.ts')],
      repositoryEntrypoints: [fileFact('src/app.ts'), fileFact('src/b/entry.ts')],
    },
  })
  const b = testManifest({
    feature: 'b',
    facts: {
      roots: [dirFact('src/b')],
      featureEntrypoints: [fileFact('src/b/entry.ts')],
      repositoryEntrypoints: [fileFact('src/app.ts'), fileFact('src/b/entry.ts')],
    },
  })
  const selectedA = selection(root, a)
  const graph = createImportGraph(root, a, selectedA.inventory)
  assert.ok(projectOwnership(graph, [selectedA]).universalSharedModules.has('src/shared/helper.ts'))
  const combined = projectOwnership(graph, [selectedA, selection(root, b)])
  assert.ok(combined.deadSharedModules.has('src/shared/helper.ts'))
})
