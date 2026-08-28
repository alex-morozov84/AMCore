// init:project --storybook=disabled: deletes apps/web/.storybook and every
// co-located *.stories.tsx file. The story-file list is discovered by
// walking the real tree at plan-build time (not hardcoded) — unlike most
// of this dimension's targets, there is no fixed, small, hand-enumerable
// list; AMCore adds a new shared/ui or feature story over time, and a
// hardcoded list would silently miss one instead of deleting it.
import { globSync } from 'node:fs'
import path from 'node:path'
import { deleteFileStep } from './init-engine.mjs'

export function buildStorybookFilesSteps(root) {
  const storybookDir = path.join(root, 'apps/web/.storybook')
  const storyFiles = globSync('apps/web/src/**/*.stories.tsx', { cwd: root })

  return [
    deleteFileStep(storybookDir, 'delete apps/web/.storybook'),
    ...storyFiles.map((rel) => deleteFileStep(path.join(root, rel), `delete ${rel}`)),
  ]
}
