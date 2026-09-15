import path from 'node:path'

import { materializeLegacySteps } from './legacy-step-materializer.mjs'

function relative(root, target) {
  return path.relative(path.resolve(root), path.resolve(target)).split(path.sep).join('/')
}

function assertNoForbiddenLegacyTargets(root, legacySteps, forbiddenTargets) {
  const forbidden = new Set(forbiddenTargets)
  const collision = legacySteps.find((step) => forbidden.has(relative(root, step.target)))
  if (collision) {
    throw new Error(
      `opaque legacy step is forbidden for shared path "${relative(root, collision.target)}"`
    )
  }
}

export function buildScaffoldOperationPlan({
  root,
  legacySteps,
  semanticSteps = [],
  forbiddenLegacyTargets = [],
}) {
  assertNoForbiddenLegacyTargets(root, legacySteps, forbiddenLegacyTargets)
  return materializeLegacySteps(root, [...legacySteps, ...semanticSteps])
}
