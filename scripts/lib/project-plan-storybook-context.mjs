// init:project --storybook=disabled: PROJECT_CONTEXT.md's frontend_storybook
// field (mirrors project-plan-context.mjs's role for the locale dimension).
import path from 'node:path'
import { fileStep, markdownFieldsTransform } from './init-engine.mjs'

/**
 * Exported on its own (not just a buildStorybookContextSteps closure) so
 * project-plan-combined.mjs can combine it with localeContextOps() into
 * one fileStep when --mode and --storybook are both given — see that
 * file's header for why two independent fileSteps on the same target
 * silently clobber each other.
 */
export function storybookContextOps() {
  return [{ label: 'frontend_storybook', value: 'disabled' }]
}

export function buildStorybookContextSteps(root) {
  return [
    fileStep(
      path.join(root, 'PROJECT_CONTEXT.md'),
      markdownFieldsTransform(storybookContextOps()),
      'update frontend_storybook for the disabled choice'
    ),
  ]
}
