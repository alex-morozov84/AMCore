import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { registerCoreCompositionAssertions } from './project-composition-core-assertions.mjs'
import {
  allProjectStates,
  buildProjectCompositionMatrix,
  projectPlan,
} from './project-composition-matrix-fixture.mjs'
import { registerSharedCompositionAssertions } from './project-composition-shared-assertions.mjs'
import { registerStorybookCompositionAssertions } from './project-composition-storybook-assertions.mjs'
import { snapshotLivePublicTree } from './project-composition-live-snapshot.mjs'

const ROOT = path.resolve('.')
const before = snapshotLivePublicTree(ROOT)
const matrix = buildProjectCompositionMatrix(ROOT)
const after = snapshotLivePublicTree(ROOT)
const initialDigest = digest(matrix.rows)

registerCoreCompositionAssertions(matrix)
registerSharedCompositionAssertions(matrix, ROOT, { before, after })
registerStorybookCompositionAssertions(matrix, ROOT)

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function audit(rows) {
  return rows
    .map((row) => {
      assert.ok(row.plan.steps.length > 0)
      assert.ok(Object.isFrozen(row.plan))
      return `${row.key}:${row.plan.operations.length}`
    })
    .sort()
}

function assertImmutable(value) {
  if (!value || typeof value !== 'object') return
  assert.equal(Buffer.isBuffer(value), false)
  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) assertImmutable(child)
}

test('prepared matrix constructs exactly 47 unique live-checkout states once', () => {
  assert.equal(matrix.buildCount, 47)
  assert.equal(matrix.rows.length, 47)
  assert.equal(new Set(matrix.rows.map((row) => row.key)).size, 47)
})

test('prepared matrix rejects duplicate, unknown, and incomplete states', () => {
  const [state] = allProjectStates()
  let builds = 0
  assert.throws(
    () =>
      buildProjectCompositionMatrix(ROOT, {
        states: [state, state],
        prepare: () => {
          builds += 1
        },
      }),
    /duplicate project state key/
  )
  assert.equal(builds, 0)
  assert.throws(() => matrix.get({ ...state, locale: 'de' }), /unknown project state value/)
  assert.throws(() => matrix.get({ locale: 'en' }), /must contain exactly/)
})

test('prepared projections are deeply immutable and expose no mutable buffers', () => {
  for (const row of matrix.rows) assertImmutable(row)
  const buffer = Buffer.from('stable bytes')
  const view = new Uint8Array([1, 2, 3])
  const projection = projectPlan({
    desiredState: {},
    localeFacts: [],
    localeSteps: [],
    sharedContentFacts: [],
    sharedContentSteps: [],
    storybookFacts: [],
    steps: [],
    operationPlan: { operationsForApply: () => [{ buffer, view }] },
    confirmMessage: '',
  })
  const stableDigest = digest(projection)
  buffer[0] = 0
  view[0] = 0
  assert.equal(digest(projection), stableDigest)
  assertImmutable(projection)
})

test('prepared projections reject executable callbacks instead of hiding them', () => {
  const plan = {
    desiredState: {},
    localeFacts: [],
    localeSteps: [],
    sharedContentFacts: [],
    sharedContentSteps: [],
    storybookFacts: [],
    steps: [{ write: () => {} }],
    operationPlan: { operationsForApply: () => [] },
    confirmMessage: '',
  }
  assert.throws(() => projectPlan(plan), /cannot contain executable callbacks/)
})

test('prepared assertions are order-independent and do not mutate matrix records', () => {
  assert.deepEqual(audit(matrix.rows), audit([...matrix.rows].reverse()))
  assert.equal(digest(matrix.rows), initialDigest)
})

test('composition assertion helpers are not independently discovered test files', () => {
  for (const retired of [
    'project-shared-content.test.mjs',
    'scaffold-coverage-contract.test.mjs',
    'project-locale-contract.test.mjs',
    'project-storybook-contract.test.mjs',
    'project-route-progress-facts.test.mjs',
    'project-storybook-facts.test.mjs',
  ]) {
    assert.equal(existsSync(path.join(ROOT, 'scripts/lib', retired)), false, retired)
  }
})
