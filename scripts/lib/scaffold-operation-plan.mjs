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

function assertCompletePermutation(allSteps, ordered) {
  if (ordered.length !== allSteps.length) {
    throw new Error('materialization steps must be a complete permutation of planned steps')
  }
  const remaining = [...allSteps]
  for (const step of ordered) {
    const index = remaining.indexOf(step)
    if (index < 0) {
      throw new Error('materialization steps must be a complete permutation of planned steps')
    }
    remaining.splice(index, 1)
  }
}

export function buildScaffoldOperationPlan({
  root,
  legacySteps,
  semanticSteps = [],
  forbiddenLegacyTargets = [],
  materializationSteps,
}) {
  assertNoForbiddenLegacyTargets(root, legacySteps, forbiddenLegacyTargets)
  const allSteps = [...legacySteps, ...semanticSteps]
  const ordered = materializationSteps ?? allSteps
  assertCompletePermutation(allSteps, ordered)
  return materializeLegacySteps(root, ordered)
}
