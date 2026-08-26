// init:project --mode=single structural steps for apps/web (ADR-071, PR3B):
// relocate the files under `[locale]/*` that need no content change, and
// delete the files/directories a single-locale app no longer needs. Files
// that both move AND need a content rewrite are a separate slice
// (project-plan-web-pages.mjs) — see moveAndRewriteStep's doc comment for
// why those can't be expressed as a move here followed by a rewrite there.
import { moveFileStep, deleteFileStep } from './init-engine.mjs'
import { resolvePureMoves, resolveDeletions } from './project-config.mjs'

export function buildWebStructureSteps(root) {
  const moveSteps = resolvePureMoves(root).map(([oldPath, newPath]) =>
    moveFileStep(oldPath, newPath, `move ${relLabel(root, oldPath)} -> ${relLabel(root, newPath)}`)
  )

  const deleteSteps = resolveDeletions(root).map((targetPath) =>
    deleteFileStep(
      targetPath,
      `delete ${relLabel(root, targetPath)} (no longer needed without locale routing)`
    )
  )

  return [...moveSteps, ...deleteSteps]
}

function relLabel(root, targetPath) {
  return targetPath.slice(root.length + 1)
}
