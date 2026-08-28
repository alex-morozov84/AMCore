// Runs read-only against the real repo — proves the hardcoded sentinel
// blocks still match the actual CI files byte-for-byte (the whole point of
// removeExactBlock: fail closed on drift, not silently skip or corrupt).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStorybookCiSteps } from './project-plan-storybook-ci.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildStorybookCiSteps (against the real repo, read-only)', () => {
  test('removes the storybook job and the dependency-review allowlist', () => {
    const [ciStep, depReviewStep] = buildStorybookCiSteps(REPO_ROOT)

    assert.equal(ciStep.changed, true)
    assert.doesNotMatch(ciStep.after, /amcore:sentinel-block.*storybook-job/)
    assert.doesNotMatch(ciStep.after, /name: Storybook/)

    assert.equal(depReviewStep.changed, true)
    assert.doesNotMatch(depReviewStep.after, /amcore:sentinel-block.*storybook-allowlist/)
    assert.doesNotMatch(depReviewStep.after, /allow-ghsas/)
  })
})
