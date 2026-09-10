// init:project --route-progress=disabled: PROJECT_CONTEXT.md's
// frontend_route_progress field (mirrors project-plan-context.mjs/
// project-plan-storybook-context.mjs's role for the other two dimensions).
// The field already exists in AMCore's shipped PROJECT_CONTEXT.md, so this
// only ever replaces a value in place — never inserts.
import path from 'node:path'
import { fileStep, markdownFieldsTransform } from './init-engine.mjs'

/**
 * Exported on its own (not just a buildRouteProgressContextSteps closure)
 * so project-plan-combined.mjs can combine it with localeContextOps() and/or
 * storybookContextOps() into one fileStep when two or more dimensions are
 * given together — see that file's header for why independent fileSteps on
 * the same target silently clobber each other.
 */
export function routeProgressContextOps() {
  return [{ label: 'frontend_route_progress', value: 'disabled' }]
}

export function buildRouteProgressContextSteps(root) {
  return [
    fileStep(
      path.join(root, 'PROJECT_CONTEXT.md'),
      markdownFieldsTransform(routeProgressContextOps()),
      'update frontend_route_progress for the disabled choice'
    ),
  ]
}
