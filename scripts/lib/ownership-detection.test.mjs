import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectUndeclaredContributions } from './ownership-contributions.mjs'
import { OWNERSHIP_CODES } from './ownership-errors.mjs'
import { createImportGraph } from './ownership-import-graph.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { fixture, fileFact, testManifest } from './ownership-test-support.mjs'

const base = {
  'src/app.ts': 'export const app = true\n',
  'src/feature/entry.ts': 'export const feature = true\n',
  'docs/feature/guide.md': '# Feature\n',
  'docs/mixed.md': 'before\nFEATURE_TOKEN\nafter\n',
  'config.json': '{"enabled":true}\n',
}

function inspect(root, manifest, changed) {
  const inventory = validateManifestInventory(root, manifest)
  const graph = createImportGraph(root, manifest, inventory)
  return detectUndeclaredContributions(root, manifest, inventory, graph, changed)
}

test('forgotten standalone test importing a feature root needs a seam', () => {
  const root = fixture({ ...base, 'test/orphan.ts': "import '@/feature/entry'\n" })
  const manifest = testManifest()
  assert.throws(
    () => inspect(root, manifest, ['test/orphan.ts']),
    (error) => error.code === OWNERSHIP_CODES.MISSING_SEAM
  )
})

test('detectable undeclared code, test, config and docs contributions fail closed', () => {
  for (const [file, content] of [
    ['src/shared.ts', 'export const value = "FEATURE_TOKEN"\n'],
    ['test/shared.ts', 'const marker = "FEATURE_TOKEN"\n'],
    ['config.json', '{"marker":"FEATURE_TOKEN"}\n'],
    ['docs/unowned.md', 'An undeclared FEATURE_TOKEN contribution.\n'],
  ]) {
    const root = fixture({ ...base, [file]: content })
    assert.throws(
      () => inspect(root, testManifest(), [file]),
      (error) => error.code === OWNERSHIP_CODES.MISSING_SEAM
    )
  }
})

test('whole-feature docs use a glob while a mixed doc uses an owned block', () => {
  const root = fixture(base)
  const mixed = {
    id: 'mixed-doc',
    ...fileFact('docs/mixed.md'),
    seamKind: 'owned-block',
    selector: { text: 'FEATURE_TOKEN' },
    detectors: ['FEATURE_TOKEN'],
    disposition: 'remove',
  }
  const manifest = testManifest({
    facts: {
      documentation: [
        {
          glob: 'docs/feature/**/*.md',
          kind: 'file',
          cardinality: 'one-or-more',
        },
      ],
    },
    seams: [mixed],
  })
  const inventory = validateManifestInventory(root, manifest)
  assert.deepEqual(inventory.matches.get(manifest.facts.documentation[0]), [
    'docs/feature/guide.md',
  ])
  assert.doesNotThrow(() => inspect(root, manifest))
})

test('a new same-file contribution outside its declared block is not hidden by that seam', () => {
  const root = fixture({ ...base, 'docs/mixed.md': 'owned FEATURE_TOKEN\nnew FEATURE_TOKEN\n' })
  const mixed = {
    id: 'mixed-doc',
    ...fileFact('docs/mixed.md'),
    seamKind: 'owned-block',
    selector: { text: 'owned FEATURE_TOKEN' },
    detectors: ['FEATURE_TOKEN'],
    disposition: 'remove',
  }
  assert.throws(
    () => inspect(root, testManifest({ seams: [mixed] }), ['docs/mixed.md']),
    (error) => error.code === OWNERSHIP_CODES.MISSING_SEAM
  )
})

test('novel semantics without an import, entrypoint or monitored identifier are undetectable', () => {
  const root = fixture({
    ...base,
    'src/shared.ts': 'export const novel = "new semantic fragment"\n',
  })
  assert.doesNotThrow(() => inspect(root, testManifest(), ['src/shared.ts']))
})
