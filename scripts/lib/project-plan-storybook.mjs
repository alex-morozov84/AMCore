// Aggregates every init:project --storybook=disabled step (ADR-071, PR4).
// Extended incrementally, slice by slice, same as project-plan.mjs was for
// the locale dimension.
import { buildStorybookCiSteps } from './project-plan-storybook-ci.mjs'

export function buildStorybookDisableSteps(root) {
  return [...buildStorybookCiSteps(root)]
}
