// Runs read-only against the real repo's actual docs — proves every
// hardcoded before-block still matches the real file (fails closed on
// drift) and that no Storybook mention survives any edited file.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStorybookDocsSteps } from './project-plan-storybook-docs.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildStorybookDocsSteps (against the real repo, read-only)', () => {
  const steps = buildStorybookDocsSteps(REPO_ROOT)

  test('deletes storybook.md and changes every other step', () => {
    assert.equal(steps[0].kind, 'delete')
    assert.ok(steps[0].target.endsWith('docs/frontend/storybook.md'))
    for (const step of steps.slice(1)) {
      assert.equal(step.changed, true, step.target)
    }
  })

  // testing.md keeps two deliberate exceptions: a past-tense PR-narrative
  // sentence ("...were all green throughout") reporting what a specific
  // historical real-stack E2E run actually covered — changing historical
  // record to match a fork's current choices would misrepresent what
  // happened, the same reasoning this repo applies to git history generally
  // — and the ADR-070 "See also" pointer (2 mentions: the ai/decisions/
  // filename plus its one-line description), a private, maintainer-only
  // reference that is simply absent (and therefore harmless) in a
  // downstream fork without the private ai/ repo.
  test('leaves no "storybook" mention (case-insensitive) in any edited doc, except testing.md\'s known exceptions', () => {
    for (const step of steps.slice(1)) {
      const mentions = step.after.match(/storybook/gi) ?? []
      const allowed = step.target.endsWith('testing.md') ? 3 : 0
      assert.equal(mentions.length, allowed, step.target)
    }
  })
})
