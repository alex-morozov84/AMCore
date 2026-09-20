import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { operationsConsoleDocSeams } from './operations-console-ownership-doc-seams.mjs'
import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

const root = process.cwd()

function cloneManifest(change) {
  const manifest = JSON.parse(JSON.stringify(operationsConsoleOwnership))
  change(manifest)
  return manifest
}

test('Operations Console manifest lists real roots, facts, seams and aliases', () => {
  const { inventory, graph, projection } = validateOwnership(root, operationsConsoleOwnership)
  // 44 -> 51: PR1 (Organizations panel) added 7 files wholly inside already
  // -declared closed roots (OrganizationsPage/{OrganizationsPage.tsx,index.ts},
  // the organizations route page.tsx, and shared/api/console/{access-token,
  // organizations}.{ts,test.ts}) - discovered automatically, no root/seam change.
  assert.equal([...inventory.rootFiles.values()].flat().length, 51)
  assert.deepEqual(operationsConsoleOwnership.tags.topology, ['disabled', 'path', 'host'])
  assert.ok(operationsConsoleDocSeams.every((seam) => seam.seamKind === 'owned-block'))
  assert.ok(graph.aliases.includes('@/*'))
  const layout = 'apps/web/src/app/[locale]/admin/(protected)/layout.tsx'
  const superAdmin = 'apps/web/src/shared/lib/require-super-admin.ts'
  assert.ok(graph.forward.get(layout).some((edge) => edge.target === superAdmin))
  assert.deepEqual(
    graph.reverse
      .get(superAdmin)
      .map((edge) => edge.importer)
      .sort(),
    [layout, 'apps/web/src/shared/lib/require-super-admin.test.ts'].sort()
  )
  assert.equal(graph.kinds.get('apps/web/src/instrumentation.test.ts'), 'test')
  assert.equal(graph.kinds.get('scripts/run-console-session-e2e.mjs'), 'production')
  assert.ok(
    graph.forward
      .get('scripts/run-console-single-locale-proxy-smoke.mjs')
      .some((edge) => edge.target === 'scripts/lib/init-project-test-helpers.mjs')
  )
  assert.equal([...graph.forward.values()].flat().length, [...graph.reverse.values()].flat().length)
  assert.equal(projection.deadSharedModules.size, 7)
  assert.equal(projection.universalSharedModules.size, 0)
})

test('a stale listed path fails closed', () => {
  const manifest = cloneManifest((draft) => {
    draft.facts.topology[0].path = 'missing.yml'
  })
  assert.throws(
    () => validateManifestInventory(root, manifest),
    (error) => error.code === OWNERSHIP_CODES.STALE_ENTRY
  )
})

test('omitting a real root entry exposes detectable files without a seam', () => {
  const manifest = cloneManifest((draft) => {
    draft.facts.roots = draft.facts.roots.filter(
      (fact) => fact.path !== 'apps/web/src/features/console-logout'
    )
  })
  assert.throws(
    () => validateOwnership(root, manifest),
    (error) => error.code === OWNERSHIP_CODES.MISSING_SEAM
  )
})

test('wrong kind and glob cardinality fail closed', () => {
  const wrongKind = cloneManifest((draft) => {
    draft.facts.roots[0].kind = 'file'
  })
  assert.throws(
    () => validateManifestInventory(root, wrongKind),
    (error) => error.code === OWNERSHIP_CODES.KIND_MISMATCH
  )
  const wrongCount = cloneManifest((draft) => {
    draft.facts.repositoryEntrypoints[0].cardinality = 'one'
  })
  assert.throws(
    () => validateManifestInventory(root, wrongCount),
    (error) => error.code === OWNERSHIP_CODES.CARDINALITY
  )
})

test('a duplicate owned-block anchor fails closed', () => {
  const manifest = cloneManifest((draft) => {
    const seam = draft.seams.find((item) => item.id === 'console.root-capability')
    seam.selector.text = 'AMCore'
  })
  assert.throws(
    () => validateOwnership(root, manifest),
    (error) => error.code === OWNERSHIP_CODES.CARDINALITY
  )
})

test('a new file inside a closed-world Console root is discovered automatically', () => {
  const copy = createRealRepoCopy()
  try {
    const relative = 'apps/web/src/features/console-login/new-owned-helper.ts'
    writeFileSync(path.join(copy.root, relative), 'export const owned = true\n')
    const { inventory } = validateOwnership(copy.root, operationsConsoleOwnership)
    assert.ok(inventory.rootFiles.get('apps/web/src/features/console-login').includes(relative))
  } finally {
    copy.cleanup()
  }
})

test('whole-file feature ownership outside a closed root is forbidden', () => {
  const manifest = cloneManifest((draft) => {
    draft.facts.featureFiles.push({
      path: 'apps/web/src/instrumentation.ts',
      kind: 'file',
      cardinality: 'one',
    })
  })
  assert.throws(
    () => validateManifestInventory(root, manifest),
    (error) => error.code === OWNERSHIP_CODES.OUTSIDE_ROOT
  )
})
