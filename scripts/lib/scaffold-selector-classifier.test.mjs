import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyChanges } from '../scaffold-selector/classify.mjs'
import { validateDeclaration } from '../scaffold-selector/declaration.mjs'

const declaration = validateDeclaration({
  schemaVersion: '1.0.0',
  contract: {},
  inputs: [
    input('planning', 'plan', 'root', ['scripts/lib']),
    input('generated-verification', 'app', 'root', ['apps', 'packages']),
    input('control', 'workflow', 'root', ['.github/workflows']),
  ],
  safeInputs: [
    {
      id: 'safe-docs',
      matcher: { kind: 'glob', patterns: ['docs/**/*.md'] },
      statuses: ['M'],
      markerPolicy: 'markers',
      rationale: 'safe prose',
    },
  ],
  memberships: [],
  markerPolicies: [{ id: 'markers', markers: ['ADMIN_CONSOLE_CONFIG'] }],
})

function input(graph, id, kind, patterns) {
  return {
    id,
    graph,
    matcher: { kind, patterns },
    statuses: ['A', 'M', 'D', 'R'],
    lane: 'generated-full',
    rationale: id,
  }
}

function classify(change, blobs = {}) {
  return classifyChanges({
    declaration,
    changes: [change],
    baseFiles: ['docs/guide.md'],
    headFiles: ['docs/guide.md'],
    readText: (side, pathname) => blobs[`${side}:${pathname}`] ?? { kind: 'text', text: '' },
  })
}

function assertFull(path, code) {
  const result = classify({ status: 'M', path })
  assert.equal(result.required, true)
  assert.ok(result.reasons.some((reason) => reason.code === code))
}

test('separates planning, verification, control, and modify-safe Markdown', () => {
  for (const [path, code] of [
    ['scripts/lib/manifest.mjs', 'planning_input_changed'],
    ['apps/api/src/example.ts', 'verification_source_changed'],
    ['packages/shared/tsconfig.json', 'verification_source_changed'],
    ['.github/workflows/other.yml', 'control_input_changed'],
  ]) {
    assertFull(path, code)
  }
  assert.equal(classify({ status: 'M', path: 'docs/guide.md' }).required, false)
})

test('fails open for A/D/R and unreadable prose', () => {
  for (const change of [
    { status: 'A', path: 'docs/new.md' },
    { status: 'D', path: 'docs/guide.md' },
    { status: 'R', oldPath: 'docs/guide.md', path: 'docs/renamed.md' },
  ])
    assert.equal(classify(change).required, true)
  const binary = {
    'base:docs/guide.md': { kind: 'binary' },
    'head:docs/guide.md': { kind: 'binary' },
  }
  assert.equal(classify({ status: 'M', path: 'docs/guide.md' }, binary).required, true)
})

test('fails open for markers, self-change, and empty diff', () => {
  const marker = {
    'base:docs/guide.md': { kind: 'text', text: '' },
    'head:docs/guide.md': { kind: 'text', text: 'ADMIN_CONSOLE_CONFIG' },
  }
  assert.ok(
    classify({ status: 'M', path: 'docs/guide.md' }, marker).reasons.some(
      (r) => r.code === 'planning_input_changed'
    )
  )
  assert.ok(
    classify({ status: 'M', path: 'scripts/scaffold-selector/new.mjs' }).reasons.some(
      (r) => r.inputId === 'control.self-protection'
    )
  )
  const empty = classifyChanges({
    declaration,
    changes: [],
    baseFiles: [],
    headFiles: [],
    readText: () => ({ kind: 'text', text: '' }),
  })
  assert.equal(empty.reasons[0].code, 'empty_diff')
})

test('glob membership changes select full independently of content changes', () => {
  const withMembership = {
    ...declaration,
    memberships: [
      {
        id: 'stories',
        graph: 'planning',
        glob: 'apps/**/*.stories.tsx',
        cardinality: 'one-or-more',
      },
    ],
  }
  const result = classifyChanges({
    declaration: withMembership,
    changes: [{ status: 'A', path: 'apps/new.stories.tsx' }],
    baseFiles: ['apps/old.stories.tsx'],
    headFiles: ['apps/old.stories.tsx', 'apps/new.stories.tsx'],
    readText: () => ({ kind: 'text', text: '' }),
  })
  assert.ok(result.reasons.some((reason) => reason.code === 'glob_membership_changed'))
})
