import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import { BRAND_PATHS, brandOwnershipFor } from './brand-ownership.mjs'
import { localeOwnership } from './locale-ownership.mjs'
import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import { routeProgressOwnership } from './project-route-progress-ownership.mjs'
import { SCAFFOLD_COVERING_SCENARIOS } from './scaffold-covering-recipes.mjs'
import { SCAFFOLD_EXHAUSTIVE_SCENARIOS } from './scaffold-scenario-recipes.mjs'
import { storybookOwnership } from './storybook-ownership.mjs'
import { readDeclaration, validateDeclarationTree } from '../scaffold-selector/declaration.mjs'
import { entryMatches } from '../scaffold-selector/paths.mjs'

const root = process.cwd()
const declaration = readDeclaration('scripts/scaffold-selector/declaration.v1.json')
const manifests = [
  brandOwnershipFor(Object.values(BRAND_PATHS)),
  operationsConsoleOwnership,
  routeProgressOwnership,
  localeOwnership,
  storybookOwnership,
]

function affected(pathname) {
  return declaration.inputs.some((input) => entryMatches(input, pathname))
}

function manifestPaths(manifest) {
  const inventory = validateManifestInventory(root, manifest)
  const facts = Object.values(manifest.facts).flat()
  return [
    ...manifest.tsconfigs,
    ...manifest.seams.map((seam) => seam.path),
    ...facts.flatMap((fact) => inventory.matches.get(fact) ?? [fact.path]).filter(Boolean),
  ]
}

test('declaration stays synchronized with manifests, operations, and scenarios', () => {
  assert.deepEqual(
    manifests.map((manifest) => manifest.feature).sort(),
    declaration.contract.manifests
  )
  for (const manifest of manifests) {
    const missing = manifestPaths(manifest).filter((pathname) => !affected(pathname))
    assert.deepEqual(missing, [], `${manifest.feature} paths need selector coverage`)
  }
  assert.deepEqual(createProjectStructuralRegistry().keys(), declaration.contract.operations)
  assert.deepEqual(
    SCAFFOLD_COVERING_SCENARIOS.map((item) => item.name).sort(),
    declaration.contract.coveringScenarios
  )
  assert.deepEqual(
    SCAFFOLD_EXHAUSTIVE_SCENARIOS.map((item) => item.name).sort(),
    declaration.contract.exhaustiveScenarios
  )
})

test('marker and protected-entrypoint projections are complete', () => {
  const declaredMarkers = declaration.markerPolicies.flatMap((policy) => policy.markers).sort()
  const liveMarkers = [
    ...new Set(manifests.flatMap((manifest) => manifest.monitoredIdentifiers)),
  ].sort()
  assert.deepEqual(declaredMarkers, liveMarkers)
  for (const pathname of declaration.contract.protectedEntrypoints) {
    assert.equal(affected(pathname), true, `${pathname} must select full`)
  }
})

test('every declared matcher pattern resolves in the current repository', () => {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' }
  )
  const files = output.split('\0').filter(Boolean)
  assert.doesNotThrow(() => validateDeclarationTree(declaration, files))
})
