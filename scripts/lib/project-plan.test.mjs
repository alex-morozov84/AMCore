// Structural invariant over the full init:project --mode=single plan,
// independent of any real-repo copy: fileStep/exactContentStep read their
// target file once at plan-build time, so two separate steps targeting the
// same path silently clobber each other at write() time (the second
// step's `after` was computed from the pre-first-step content). Caught
// live in auth.service.spec.ts — two builders each owned a fileStep for it.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProjectSteps } from './project-plan.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildProjectSteps (structural, against the real repo — read-only)', () => {
  test('no two edit-kind steps target the same file', () => {
    const steps = buildProjectSteps(REPO_ROOT, { locale: 'en' })
    const editTargets = steps.filter((step) => step.kind === 'edit').map((step) => step.target)

    const seen = new Set()
    const duplicates = new Set()
    for (const target of editTargets) {
      if (seen.has(target)) duplicates.add(target)
      seen.add(target)
    }

    assert.deepEqual([...duplicates], [])
  })
})
