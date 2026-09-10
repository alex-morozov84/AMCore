// init:project --route-progress=disabled: flips route-progress-flag.ts's
// exported const, and only that -- no file/test/story/wiring is deleted
// (owner decision, 2026-09-09). This is the one dimension whose apply step
// never overlaps another dimension's target, so it needs no combined-steps
// handling of its own (unlike its PROJECT_CONTEXT.md field -- see
// project-plan-route-progress-context.mjs and project-plan-combined.mjs).
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'
import { ROUTE_PROGRESS_FLAG_PATH } from './project-config-route-progress.mjs'

const BEFORE = `/**
 * Single reversible on/off switch for the top route-progress bar. Not a
 * runtime/user preference (owner decision, 2026-09-09 — see
 * \`docs/frontend/route-progress.md\`): a developer or agent edits this file
 * directly to enable/disable the feature after scaffolding, with no
 * initializer rerun (a normal application rebuild/deploy still applies).
 * \`pnpm init:project --route-progress=disabled\`
 * only sets this const's *initial* value to \`false\` and records the choice
 * in \`PROJECT_CONTEXT.md\` — it never deletes this file or any other part of
 * the feature. Flipping it back to \`true\` by hand fully restores the bar.
 */
export const ROUTE_PROGRESS_ENABLED = true
`

const AFTER = `/**
 * Single reversible on/off switch for the top route-progress bar. Not a
 * runtime/user preference (owner decision, 2026-09-09 — see
 * \`docs/frontend/route-progress.md\`): a developer or agent edits this file
 * directly to enable/disable the feature after scaffolding, with no
 * initializer rerun (a normal application rebuild/deploy still applies).
 * \`pnpm init:project --route-progress=disabled\`
 * only sets this const's *initial* value to \`false\` and records the choice
 * in \`PROJECT_CONTEXT.md\` — it never deletes this file or any other part of
 * the feature. Flipping it back to \`true\` by hand fully restores the bar.
 *
 * This fork chose \`--route-progress=disabled\` at scaffold time, so the bar
 * starts off. Flip the line below to \`true\` to turn it back on — and keep
 * \`PROJECT_CONTEXT.md\`'s \`frontend_route_progress\` field truthful when you do.
 */
export const ROUTE_PROGRESS_ENABLED = false
`

export function buildRouteProgressFlagSteps(root) {
  return [
    exactContentStep(
      path.join(root, ROUTE_PROGRESS_FLAG_PATH),
      { expectedBefore: BEFORE, after: AFTER },
      'route-progress-flag.ts: set ROUTE_PROGRESS_ENABLED to false'
    ),
  ]
}
