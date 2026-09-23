import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectUndeclaredContributions } from './ownership-contributions.mjs'
import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { createImportGraph } from './ownership-import-graph.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { projectOwnership } from './ownership-projection.mjs'
import { fileFact, fixture, testManifest } from './ownership-test-support.mjs'

const helper = 'apps/web/e2e/real-stack/admin-helpers.ts'
const spec = 'apps/web/e2e/real-stack/admin-role.spec.ts'
const source = {
  'src/app.ts': 'export const app = true\n',
  'src/feature/entry.ts': 'export const feature = true\n',
  [helper]: 'export const admin = true\n',
  [spec]: "import { admin } from './admin-helpers'\nvoid admin\n",
}

function inspect(files, options = {}) {
  const root = fixture(files)
  const manifest = testManifest({
    surfaceRoots: ['src', 'test', 'docs', 'apps/web/e2e'],
    facts: {
      verification: options.sharedModule
        ? []
        : [fileFact(helper), ...(options.registerSpec ? [fileFact(spec)] : [])],
      sharedModules: options.sharedModule ? [fileFact(helper)] : [],
    },
    seams: options.seams ?? [],
  })
  const inventory = validateManifestInventory(root, manifest)
  const graph = createImportGraph(root, manifest, inventory)
  const projection = projectOwnership(graph, [{ manifest, inventory }])
  return () =>
    detectUndeclaredContributions(
      root,
      manifest,
      inventory,
      graph,
      [options.importer ?? spec],
      projection
    )
}

test('unregistered sibling spec importing a removed Console helper fails by source and target', () => {
  assert.throws(inspect(source), (error) => {
    assert.equal(error.code, OWNERSHIP_CODES.MISSING_SEAM)
    assert.match(error.message, /admin-role\.spec\.ts/)
    assert.match(error.message, /admin-helpers\.ts/)
    return true
  })
})

test('registered verification importer is owned', () => {
  assert.doesNotThrow(inspect(source, { registerSpec: true }))
})

test('a source under the closed feature root is owned automatically', () => {
  const importer = 'src/feature/child.ts'
  assert.doesNotThrow(inspect({ ...source, [importer]: "import './entry'\n" }, { importer }))
})

test('an explicit removeImports seam covers the import edge', () => {
  const seam = {
    id: 'admin-role-import',
    ...fileFact(spec),
    seamKind: 'owned-block',
    selector: { text: './admin-helpers' },
    detectors: ['feature-import'],
    removeImports: [helper],
    disposition: 'remove',
  }
  assert.doesNotThrow(inspect(source, { seams: [seam] }))
})

test('a universal shared target does not require importer ownership', () => {
  const files = { ...source, 'src/app.ts': `import '../${helper}'\n` }
  assert.doesNotThrow(inspect(files, { sharedModule: true }))
})
