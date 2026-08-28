// Path/guard for init:project --storybook=disabled (ADR-071, PR4) — a
// separate file from project-config.mjs (the locale dimension's config) to
// stay under the repo's ~150-line-per-file guidance; the two dimensions are
// otherwise independent (owner decision: either flag works alone or together).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { EngineError, readMarkdownField } from './actions.mjs'

export const STORYBOOK_VALUES = ['disabled']

/**
 * The reinitialize guard for this dimension, mirroring
 * assertMultiLocaleAppStructure's role for the locale dimension: checks
 * both the file-presence ground truth (apps/web/.storybook) and
 * PROJECT_CONTEXT.md's own frontend_storybook field, since either one
 * alone could be stale if a checkout was hand-edited.
 */
export function assertStorybookEnabled(root) {
  const storybookDir = path.join(root, 'apps/web/.storybook')
  if (!existsSync(storybookDir)) {
    throw new EngineError(
      `${storybookDir} does not exist — either init:project --storybook=disabled has already ` +
        'been applied to this checkout, or Storybook was never enabled here.'
    )
  }

  const contextPath = path.join(root, 'PROJECT_CONTEXT.md')
  const context = readFileSync(contextPath, 'utf8')
  const field = readMarkdownField(context, 'frontend_storybook')
  if (field === 'disabled') {
    throw new EngineError(
      `${contextPath} already declares frontend_storybook: disabled, but ${storybookDir} still ` +
        'exists — the checkout is in an inconsistent state; resolve that by hand before re-running.'
    )
  }
}

/**
 * Unlike the locale dimension, this one edits apps/web/package.json's
 * dependency list — which leaves pnpm-lock.yaml stale the moment the apply
 * writes. Running `pnpm install` to fix that is exactly the production
 * network/node_modules-mutation hazard runProjectVerification is built to
 * never cause (see verify.mjs's header) — confirmed live: CI=true's
 * --frozen-lockfile-like behavior makes every later typecheck/lint/build/
 * test step fail immediately on the mismatch, before doing any real work.
 * Printed instead of running that automated verification for this
 * dimension; init-project.mjs skips it (verify: () => []) whenever
 * --storybook is part of the apply.
 */
export function storybookInstallFollowUpMessage() {
  return (
    'Storybook: apps/web/package.json dependencies changed. Automated post-apply ' +
    'verification was skipped for this reason — run `pnpm install`, then verify manually: ' +
    'pnpm typecheck && pnpm lint && pnpm --filter web build && pnpm --filter api test && ' +
    'pnpm --filter web test.'
  )
}
