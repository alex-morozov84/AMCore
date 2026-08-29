// Structural invariant over the full init:project plans, independent of any
// real-repo copy: fileStep/exactContentStep read their target file once at
// plan-build time, so two separate steps targeting the same path silently
// clobber each other at write() time (the second step's `after` was
// computed from the pre-first-step content). Caught live twice: first in
// auth.service.spec.ts (two builders owned a fileStep for it), then in
// PROJECT_CONTEXT.md/eslint.config.mjs when --mode and --storybook combine
// (see project-plan-combined.mjs). Covers each dimension alone and
// combined, mirroring init-project.mjs's own filter+combine composition —
// not a naive concatenation, which would trivially fail on the combined
// case by design (the whole reason project-plan-combined.mjs exists).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProjectSteps } from './project-plan.mjs'
import { buildStorybookDisableSteps } from './project-plan-storybook.mjs'
import { combinedTargets, buildCombinedSteps } from './project-plan-combined.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function assertNoDuplicateEditTargets(steps) {
  const editTargets = steps.filter((step) => step.kind === 'edit').map((step) => step.target)
  const seen = new Set()
  const duplicates = new Set()
  for (const target of editTargets) {
    if (seen.has(target)) duplicates.add(target)
    seen.add(target)
  }
  assert.deepEqual([...duplicates], [])
}

describe('init:project plans (structural, against the real repo — read-only)', () => {
  test('locale dimension alone: no two edit-kind steps target the same file', () => {
    assertNoDuplicateEditTargets(buildProjectSteps(REPO_ROOT, { locale: 'en' }))
  })

  test('storybook dimension alone: no two edit-kind steps target the same file', () => {
    assertNoDuplicateEditTargets(buildStorybookDisableSteps(REPO_ROOT))
  })

  test('both dimensions together, composed the way init-project.mjs does: no duplicate targets', () => {
    const overlap = new Set(combinedTargets(REPO_ROOT))
    assertNoDuplicateEditTargets([
      ...buildProjectSteps(REPO_ROOT, { locale: 'en' }).filter((s) => !overlap.has(s.target)),
      ...buildStorybookDisableSteps(REPO_ROOT).filter((s) => !overlap.has(s.target)),
      ...buildCombinedSteps(REPO_ROOT, 'en'),
    ])
  })

  test('regression guard: a naive concatenation of both dimensions DOES collide', () => {
    // Proves the guard above is non-vacuous — if project-plan-combined.mjs's
    // filtering were ever removed, this is the failure it exists to catch.
    const steps = [
      ...buildProjectSteps(REPO_ROOT, { locale: 'en' }),
      ...buildStorybookDisableSteps(REPO_ROOT),
    ]
    assert.throws(() => assertNoDuplicateEditTargets(steps))
  })
})
