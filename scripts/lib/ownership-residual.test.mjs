import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { assertProjectionResiduals } from './ownership-residual.mjs'
import { fileFact, fixture, graph, testManifest } from './ownership-test-support.mjs'

function setup() {
  const root = fixture({
    'src/app.ts': 'export const app = true\n',
    'src/feature/entry.ts': 'export const feature = true\n',
    'src/shared.ts': 'before FEATURE_TOKEN after\n',
    'config.json': '{}',
  })
  const seam = {
    id: 'shared',
    ...fileFact('src/shared.ts'),
    seamKind: 'owned-block',
    selector: { text: 'FEATURE_TOKEN' },
    detectors: ['FEATURE_TOKEN'],
    disposition: 'remove',
  }
  const manifest = testManifest({ seams: [seam] })
  return { root, selection: { manifest, inventory: validateManifestInventory(root, manifest) } }
}

test('residual checks reject remaining root files and owned seam identifiers', () => {
  const { selection } = setup()
  const projection = { removed: new Set(), forward: new Map() }
  const files = new Set(['src/app.ts', 'src/feature/entry.ts', 'src/shared.ts'])
  const contents = new Map([['src/shared.ts', 'before FEATURE_TOKEN after\n']])
  assert.throws(
    () => assertProjectionResiduals([selection], projection, files, contents),
    (error) => error.code === OWNERSHIP_CODES.RESIDUAL
  )
})

test('residual checks accept a clean projected surface', () => {
  const { selection } = setup()
  const projection = {
    removed: new Set(['src/feature/entry.ts']),
    forward: graph(['src/app.ts', 'src/shared.ts'], []).forward,
  }
  assert.doesNotThrow(() =>
    assertProjectionResiduals(
      [selection],
      projection,
      new Set(['src/app.ts', 'src/shared.ts']),
      new Map([['src/shared.ts', 'before after\n']])
    )
  )
})
