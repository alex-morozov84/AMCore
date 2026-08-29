// Runs read-only against the real repo's actual PROJECT_CONTEXT.md.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  storybookContextOps,
  removeStorybookDocLinkFromContext,
  buildStorybookContextSteps,
} from './project-plan-storybook-context.mjs'
import { markdownFieldsTransform } from './init-engine.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REAL_CONTEXT = readFileSync(path.join(REPO_ROOT, 'PROJECT_CONTEXT.md'), 'utf8')

describe('project-plan-storybook-context', () => {
  test('storybookContextOps() sets frontend_storybook to disabled', () => {
    const applied = markdownFieldsTransform(storybookContextOps())(REAL_CONTEXT)
    assert.match(applied, /- \*\*frontend_storybook:\*\* disabled/)
  })

  test('removeStorybookDocLinkFromContext() matches the real bullet and drops the dead link', () => {
    const rewritten = removeStorybookDocLinkFromContext(REAL_CONTEXT)
    assert.doesNotMatch(rewritten, /docs\/frontend\/storybook\.md/)
    // The bullet's substance (what disabling Storybook did) must survive the rewrite.
    assert.match(rewritten, /This fork has disabled it: `\.storybook\/`/)
  })

  test('buildStorybookContextSteps(): the built step leaves neither the enabled value nor the dead link', () => {
    const [step] = buildStorybookContextSteps(REPO_ROOT)

    assert.match(step.after, /- \*\*frontend_storybook:\*\* disabled/)
    // Regression: the field used to be updated without touching the prose
    // bullet a few lines above it, which still cited docs/frontend/storybook.md
    // -- a file this same --storybook=disabled apply deletes.
    assert.doesNotMatch(step.after, /docs\/frontend\/storybook\.md/)
  })
})
