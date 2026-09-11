// Structural invariant over the full init:project plans, independent of any
// real-repo copy: fileStep/exactContentStep read their target file once at
// plan-build time, so two separate steps targeting the same path silently
// clobber each other at write() time (the second step's `after` was
// computed from the pre-first-step content). Caught live: auth.service.spec.ts
// (two builders owned a fileStep for it), then PROJECT_CONTEXT.md/
// eslint.config.mjs when --mode and --storybook combine (see
// project-plan-combined.mjs). Covers all seven non-empty combinations of
// the three dimensions (FINAL PLAN item 10), mirroring init-project.mjs's
// own filter+combine composition — not a naive concatenation, which would
// trivially fail on any combined case by design (the whole reason
// project-plan-combined.mjs exists).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProjectSteps } from './project-plan.mjs'
import { buildStorybookDisableSteps } from './project-plan-storybook.mjs'
import { buildRouteProgressFlagSteps } from './project-plan-route-progress-flag.mjs'
import { buildRouteProgressContextSteps } from './project-plan-route-progress-context.mjs'
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

/** Mirrors init-project.mjs's own filter+combine composition exactly. */
function composedSteps({ locale, storybook, routeProgress }) {
  const dims = { locale, storybook, routeProgress }
  const overlap = new Set(combinedTargets(REPO_ROOT, dims))
  return [
    ...(locale
      ? buildProjectSteps(REPO_ROOT, { locale }).filter((s) => !overlap.has(s.target))
      : []),
    ...(storybook
      ? buildStorybookDisableSteps(REPO_ROOT).filter((s) => !overlap.has(s.target))
      : []),
    ...(routeProgress
      ? [
          ...buildRouteProgressFlagSteps(REPO_ROOT),
          ...buildRouteProgressContextSteps(REPO_ROOT).filter((s) => !overlap.has(s.target)),
        ]
      : []),
    ...buildCombinedSteps(REPO_ROOT, dims),
  ]
}

const COMBINATIONS = [
  { name: 'locale alone', locale: 'en' },
  { name: 'storybook alone', storybook: 'disabled' },
  { name: 'route-progress alone', routeProgress: true },
  { name: 'locale + storybook', locale: 'en', storybook: 'disabled' },
  { name: 'locale + route-progress', locale: 'en', routeProgress: true },
  { name: 'storybook + route-progress', storybook: 'disabled', routeProgress: true },
  { name: 'all three', locale: 'en', storybook: 'disabled', routeProgress: true },
]

describe('init:project plans (structural, against the real repo — read-only)', () => {
  for (const combo of COMBINATIONS) {
    test(`${combo.name}: no two edit-kind steps target the same file`, () => {
      assertNoDuplicateEditTargets(composedSteps(combo))
    })
  }

  test('regression guard: a naive concatenation of all three dimensions DOES collide', () => {
    // Proves the guards above are non-vacuous — if project-plan-combined.mjs's
    // filtering were ever removed, this is the failure it exists to catch.
    const steps = [
      ...buildProjectSteps(REPO_ROOT, { locale: 'en' }),
      ...buildStorybookDisableSteps(REPO_ROOT),
      ...buildRouteProgressFlagSteps(REPO_ROOT),
      ...buildRouteProgressContextSteps(REPO_ROOT),
    ]
    assert.throws(() => assertNoDuplicateEditTargets(steps))
  })
})
