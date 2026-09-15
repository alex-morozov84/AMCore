// Aggregates every init:project --storybook=disabled step (ADR-071, PR4).
// Extended incrementally, slice by slice, same as project-plan.mjs was for
// the locale dimension.
import { buildStorybookCiSteps } from './project-plan-storybook-ci.mjs'
import { buildStorybookVitestSteps } from './project-plan-storybook-vitest.mjs'
import { buildStorybookFilesSteps } from './project-plan-storybook-files.mjs'
import { buildStorybookDocsSteps } from './project-plan-storybook-docs.mjs'

export function buildStorybookDisableSteps(root) {
  return [
    ...buildStorybookCiSteps(root),
    ...buildStorybookVitestSteps(root),
    ...buildStorybookFilesSteps(root),
    ...buildStorybookDocsSteps(root),
  ]
}
